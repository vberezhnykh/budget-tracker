import { useEffect, useId, useRef, useState } from 'react';
import { LoaderCircle, Sparkles } from 'lucide-react';
import { FormLabel } from '../ui/Field';
import Button from '../ui/Button';
import InlineAlert from '../ui/InlineAlert';
import { toLocalDateInput } from '../../utils/period';
import './QuickEntry.css';

const UNPARSED_TEXT = 'Не получилось разобрать фразу. Добавьте сумму и на что потрачено или заполните поля вручную.';
const NETWORK_TEXT = 'Не удалось связаться с сервером. Заполните поля вручную.';
const MIN_PHRASE_LENGTH = 2;

const HINT_STYLE = { margin: 'var(--space-1-5) 0 0', color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', lineHeight: 1.5 };

// Фраза вместо полей: «кофе 3.50 старбакс вчера с карты». Компонент только
// спрашивает сервер и отдаёт черновик наверх (onDraft); что с ним делать и
// как вернуть прежнее, решает форма. Ничего не сохраняет.
//
// onBusyChange(true) на время запроса - форма на это время приглушается.
// accountMissing - форма сообщает, что счёт после заполнения остался пустым.
export default function QuickEntry({ apiFetch, onDraft, onRevert, accountMissing = false, onBusyChange }) {
    const inputId = useId();
    const [text, setText] = useState('');
    // 'idle' | 'loading' | 'filled' | 'error'
    const [status, setStatus] = useState('idle');
    const [errorText, setErrorText] = useState('');
    const controllerRef = useRef(null);

    const loading = status === 'loading';
    const canFill = text.trim().length >= MIN_PHRASE_LENGTH;

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
    }, []);

    // Устаревший ответ: запрос отменён (лист закрыт) или начат другой.
    const isStale = (controller) => controller.signal.aborted || controllerRef.current !== controller;

    const fill = async () => {
        if (loading || !canFill) return;
        controllerRef.current?.abort();
        const controller = new AbortController();
        controllerRef.current = controller;
        setStatus('loading');
        setErrorText('');
        onBusyChange?.(true);
        try {
            const response = await (apiFetch || fetch)('/api/quick-entry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text.trim(), today: toLocalDateInput() }),
                signal: controller.signal,
            });
            const body = await response.json().catch(() => null);
            if (isStale(controller)) return;
            onBusyChange?.(false);
            if (!response.ok || !body?.draft) {
                setErrorText(body?.message || UNPARSED_TEXT);
                setStatus('error');
                return;
            }
            onDraft(body.draft);
            setStatus('filled');
        } catch {
            if (isStale(controller)) return;
            onBusyChange?.(false);
            setErrorText(NETWORK_TEXT);
            setStatus('error');
        }
    };

    // Правка фразы после ответа возвращает строку состояния в исходный вид,
    // но значения в форме остаются: они уже могут быть правлены руками.
    const changeText = (value) => {
        setText(value);
        if (status === 'filled' || status === 'error') setStatus('idle');
    };

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
                    padding: 'var(--space-1-5) var(--space-1-5) var(--space-1-5) 14px',
                    border: '1px solid var(--color-primary-border)',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--color-primary-soft)',
                }}
            >
                <Sparkles size={18} color="var(--color-primary)" aria-hidden="true" />
                <input
                    id={inputId}
                    className="quick-entry__input"
                    type="text"
                    enterKeyHint="go"
                    autoComplete="off"
                    placeholder="кофе 3.50 Старбакс с карты"
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
                            Разбираю…
                        </>
                    ) : 'Заполнить'}
                </Button>
            </div>

            {status === 'error' ? (
                <div style={{ marginTop: 'var(--space-2)' }}>
                    <InlineAlert tone="danger">{errorText}</InlineAlert>
                </div>
            ) : status === 'filled' ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 'var(--space-3)', marginTop: 'var(--space-1-5)' }}>
                    <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', lineHeight: 1.5 }}>
                        Заполнено по фразе. Проверьте поля.{accountMissing ? ' Счет не назван, выберите его.' : ''}
                    </span>
                    <Button
                        tone="text"
                        onClick={() => { onRevert(); setStatus('idle'); }}
                        style={{ minHeight: '28px', fontSize: 'var(--text-sm)' }}
                    >
                        Вернуть как было
                    </Button>
                </div>
            ) : (
                <p style={HINT_STYLE}>
                    {loading ? 'Обычно это занимает секунду-две.' : 'Сумма, на что, где и с какого счета. Можно продиктовать с клавиатуры.'}
                </p>
            )}
        </div>
    );
}
