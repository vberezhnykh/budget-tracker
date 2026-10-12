import { useEffect, useId, useRef, useState } from 'react';
import { Camera, LoaderCircle } from 'lucide-react';
import { FormLabel } from '../ui/Field';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import InlineAlert from '../ui/InlineAlert';
import ReceiptPreview from './ReceiptPreview';
import { prepareReceiptImage } from './receiptImage';
import { toLocalDateInput } from '../../utils/period';
import './QuickEntry.css';

const UNPARSED_TEXT = 'Не получилось разобрать фразу. Добавьте сумму и на что потрачено или заполните поля вручную.';
const RECEIPT_UNPARSED_TEXT = 'Не удалось прочитать чек. Сфотографируйте его целиком, ровно и при хорошем свете или заполните поля вручную.';
const NETWORK_TEXT = 'Не удалось связаться с сервером. Заполните поля вручную.';
const MIN_PHRASE_LENGTH = 2;

const HINT_STYLE = { margin: 'var(--space-1-5) 0 0', color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', lineHeight: 1.5 };

// Адрес картинки живёт, пока фото прикреплено; без createObjectURL (тесты,
// старые браузеры) миниатюра просто остаётся пустой.
const makeUrl = (blob) => {
    try {
        return URL.createObjectURL(blob);
    } catch {
        return '';
    }
};
const freeUrl = (url) => {
    if (!url) return;
    try {
        URL.revokeObjectURL(url);
    } catch {
        // нечего освобождать
    }
};

// Фраза вместо полей: «кофе 3.50 старбакс вчера с карты». Рядом камера: фото
// чека читается так же, а слова в строке становятся пояснением к нему
// («с Revolut»). Компонент только спрашивает сервер и отдаёт черновик наверх
// (onDraft); что с ним делать и как вернуть прежнее, решает форма. Ничего не
// сохраняет, фото остаётся только в памяти страницы.
//
// Пока фото прикреплено, «Заполнить» читает его заново с текущим текстом.
//
// onBusyChange(true) на время запроса - форма на это время приглушается.
// accountMissing - форма сообщает, что счёт после заполнения остался пустым.
export default function QuickEntry({ apiFetch, onDraft, onRevert, accountMissing = false, onBusyChange }) {
    const inputId = useId();
    const [text, setText] = useState('');
    // 'idle' | 'loading' | 'filled' | 'error'
    const [status, setStatus] = useState('idle');
    const [errorText, setErrorText] = useState('');
    // Чем заполнено или что идёт сейчас: 'phrase' | 'receipt'
    const [mode, setMode] = useState('phrase');
    const [splitFilled, setSplitFilled] = useState(false);
    // Прикреплённое фото: { blob, url } - уже уменьшенное и в JPEG
    const [photo, setPhoto] = useState(null);
    const [previewOpen, setPreviewOpen] = useState(false);
    const controllerRef = useRef(null);
    const photoRef = useRef(null);
    const fileInputRef = useRef(null);
    const cameraRef = useRef(null);
    const thumbRef = useRef(null);
    const focusCameraRef = useRef(false);
    const focusThumbRef = useRef(false);

    const loading = status === 'loading';
    const trimmed = text.trim();
    const canFill = photo ? true : trimmed.length >= MIN_PHRASE_LENGTH;
    const receiptMode = mode === 'receipt';

    // Закрыли лист - ответ уже никому не нужен, а форма не должна остаться
    // приглушённой. Родитель получает onBusyChange вместе со сменой состояния,
    // а не из эффекта: иначе после ответа форма ещё кадр оставалась бы тусклой.
    const onBusyChangeRef = useRef(onBusyChange);
    useEffect(() => {
        onBusyChangeRef.current = onBusyChange;
    });
    useEffect(() => () => {
        controllerRef.current?.abort();
        onBusyChangeRef.current?.(false);
        freeUrl(photoRef.current?.url);
    }, []);

    // Просмотр закрыт - фокус возвращается на миниатюру; фото убрали из
    // просмотра - миниатюры больше нет, фокус на камеру.
    useEffect(() => {
        if (photo || !focusCameraRef.current) return;
        focusCameraRef.current = false;
        cameraRef.current?.focus();
    }, [photo]);
    useEffect(() => {
        if (previewOpen || !focusThumbRef.current) return;
        focusThumbRef.current = false;
        thumbRef.current?.focus();
    }, [previewOpen]);

    // Устаревший ответ: запрос отменён (лист закрыт) или начат другой.
    const isStale = (controller) => controller.signal.aborted || controllerRef.current !== controller;

    const begin = (nextMode) => {
        controllerRef.current?.abort();
        const controller = new AbortController();
        controllerRef.current = controller;
        setMode(nextMode);
        setStatus('loading');
        setErrorText('');
        onBusyChange?.(true);
        return controller;
    };

    const fail = (controller, message) => {
        if (isStale(controller)) return;
        onBusyChange?.(false);
        setErrorText(message);
        setStatus('error');
    };

    // Ответ сервера: черновик уходит в форму, иначе показываем его сообщение.
    const settle = async (controller, response, fallback) => {
        const body = await response.json().catch(() => null);
        if (isStale(controller)) return;
        onBusyChange?.(false);
        if (!response.ok || !body?.draft) {
            setErrorText(body?.message || fallback);
            setStatus('error');
            return;
        }
        onDraft(body.draft);
        setSplitFilled(Array.isArray(body.draft.splits));
        setStatus('filled');
    };

    const readPhrase = async () => {
        const controller = begin('phrase');
        try {
            const response = await (apiFetch || fetch)('/api/quick-entry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: trimmed, today: toLocalDateInput() }),
                signal: controller.signal,
            });
            await settle(controller, response, UNPARSED_TEXT);
        } catch {
            fail(controller, NETWORK_TEXT);
        }
    };

    // Фото уходит как есть (JPEG), а пояснение и «сегодня» - заголовками: так
    // текст не попадает в адрес и в журнал доступа.
    const sendReceipt = async (controller, blob) => {
        try {
            const note = trimmed.length >= MIN_PHRASE_LENGTH ? trimmed : '';
            const response = await (apiFetch || fetch)('/api/quick-entry/receipt', {
                method: 'POST',
                headers: {
                    'Content-Type': 'image/jpeg',
                    'X-Quick-Entry-Today': toLocalDateInput(),
                    ...(note ? { 'X-Quick-Entry-Text': encodeURIComponent(note) } : {}),
                },
                body: blob,
                signal: controller.signal,
            });
            await settle(controller, response, RECEIPT_UNPARSED_TEXT);
        } catch {
            fail(controller, NETWORK_TEXT);
        }
    };

    const attach = (blob) => {
        freeUrl(photoRef.current?.url);
        const next = { blob, url: makeUrl(blob) };
        photoRef.current = next;
        setPhoto(next);
    };

    const detach = () => {
        freeUrl(photoRef.current?.url);
        photoRef.current = null;
        setPhoto(null);
    };

    // Выбрали фото - чтение начинается сразу, с тем текстом, что уже в строке.
    const choosePhoto = async (file) => {
        const controller = begin('receipt');
        let blob;
        try {
            blob = await prepareReceiptImage(file);
        } catch (error) {
            fail(controller, error?.message || RECEIPT_UNPARSED_TEXT);
            return;
        }
        if (isStale(controller)) return;
        attach(blob);
        await sendReceipt(controller, blob);
    };

    const fill = () => {
        if (loading || !canFill) return;
        if (photoRef.current) sendReceipt(begin('receipt'), photoRef.current.blob);
        else readPhrase();
    };

    const pickPhoto = () => fileInputRef.current?.click();

    // Правка фразы после ответа возвращает строку состояния в исходный вид,
    // но значения в форме остаются: они уже могут быть правлены руками.
    const changeText = (value) => {
        setText(value);
        if (status === 'filled' || status === 'error') setStatus('idle');
    };

    const closePreview = () => {
        focusThumbRef.current = true;
        setPreviewOpen(false);
    };

    const removePhoto = () => {
        focusCameraRef.current = true;
        detach();
        setPreviewOpen(false);
        if (status === 'filled' || status === 'error') setStatus('idle');
    };

    const statusText = !receiptMode
        ? 'Заполнено по фразе. Проверьте поля.'
        : splitFilled
            ? 'В чеке товары разных категорий, сумма разделена. Проверьте части.'
            : 'Заполнено по чеку. Проверьте поля.';

    return (
        <div>
            <FormLabel htmlFor={inputId}>Опишите операцию</FormLabel>
            <div
                className="quick-entry__row"
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    minHeight: '52px',
                    boxSizing: 'border-box',
                    padding: 'var(--space-1-5)',
                    border: '1px solid var(--color-primary-border)',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--color-primary-soft)',
                }}
            >
                {photo ? (
                    <button
                        ref={thumbRef}
                        type="button"
                        className="quick-entry__thumb"
                        aria-label="Открыть фото чека"
                        onClick={() => setPreviewOpen(true)}
                    >
                        {photo.url && <img src={photo.url} alt="" />}
                    </button>
                ) : (
                    <IconButton
                        ref={cameraRef}
                        className="quick-entry__camera"
                        aria-label="Сфотографировать чек"
                        disabled={loading}
                        onClick={pickPhoto}
                        style={{
                            width: '40px',
                            height: '40px',
                            padding: 0,
                            border: '1px solid var(--color-primary-border)',
                            borderRadius: 'var(--radius-sm)',
                            background: 'var(--color-surface)',
                            color: 'var(--color-primary)',
                        }}
                    >
                        <Camera size={20} strokeWidth={1.8} aria-hidden="true" />
                    </IconButton>
                )}
                {/* Без capture: iOS сам предложит снять или выбрать из галереи */}
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    tabIndex={-1}
                    onChange={e => {
                        const file = e.target.files?.[0];
                        // Тот же файл можно выбрать снова
                        e.target.value = '';
                        if (file) choosePhoto(file);
                    }}
                />
                <input
                    id={inputId}
                    className="quick-entry__input"
                    type="text"
                    enterKeyHint="go"
                    autoComplete="off"
                    placeholder={photo ? 'Уточнение к чеку' : 'кофе 3.50 с карты'}
                    readOnly={loading}
                    value={text}
                    onChange={e => changeText(e.target.value)}
                    onKeyDown={e => {
                        if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                        e.preventDefault();
                        fill();
                    }}
                />
                <Button
                    size="sm"
                    aria-busy={loading || undefined}
                    disabled={!loading && !canFill}
                    onClick={fill}
                    style={{
                        height: '40px',
                        padding: loading ? '0 var(--space-3)' : '0 14px',
                        fontSize: 'var(--text-base)',
                        // Пока ждём ответ, кнопка остаётся залитой: серая
                        // выглядела бы как «нельзя», а ждать как раз можно.
                        ...(loading ? { cursor: 'progress' } : null),
                        // Неактивная кнопка - плоская серая, как в макете:
                        // тень и градиент фирменной кнопке здесь ни к чему.
                        ...(!loading && !canFill ? { background: 'var(--color-surface-inset)', color: 'var(--color-text-muted)', boxShadow: 'none', opacity: 1 } : null),
                    }}
                >
                    {loading ? (
                        <>
                            <LoaderCircle className="quick-entry__spinner" size={16} strokeWidth={2.2} aria-hidden="true" />
                            {receiptMode ? 'Читаю чек…' : 'Разбираю…'}
                        </>
                    ) : 'Заполнить'}
                </Button>
            </div>

            {status === 'error' ? (
                <div style={{ marginTop: 'var(--space-2)' }}>
                    <InlineAlert tone="danger">
                        {errorText}
                        {receiptMode && (
                            <div style={{ marginTop: 'var(--space-2)' }}>
                                <Button tone="secondary" size="sm" onClick={pickPhoto}>
                                    <Camera size={16} strokeWidth={1.8} aria-hidden="true" />
                                    Другое фото
                                </Button>
                            </div>
                        )}
                    </InlineAlert>
                </div>
            ) : status === 'filled' ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 'var(--space-3)', marginTop: 'var(--space-1-5)' }}>
                    <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', lineHeight: 1.5 }}>
                        {statusText}{accountMissing ? ' Счет не назван, выберите его.' : ''}
                    </span>
                    <Button
                        tone="text"
                        onClick={() => { onRevert(); setStatus('idle'); }}
                        style={{ minHeight: '28px', fontSize: 'var(--text-sm)' }}
                    >
                        Вернуть как было
                    </Button>
                </div>
            ) : loading ? (
                <p style={HINT_STYLE}>
                    {receiptMode ? 'Чек читается дольше фразы, обычно 3–5 секунд.' : 'Обычно это занимает секунду-две.'}
                </p>
            ) : !photo ? (
                <p style={HINT_STYLE}>
                    Напишите, что купили, или сфотографируйте чек. Слова к фото тоже учитываются: «с Revolut».
                </p>
            ) : null}

            {previewOpen && photo && (
                <ReceiptPreview
                    url={photo.url}
                    onClose={closePreview}
                    onReplace={() => { closePreview(); pickPhoto(); }}
                    onRemove={removePhoto}
                />
            )}
        </div>
    );
}
