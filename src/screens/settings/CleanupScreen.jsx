import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BrushCleaning, CircleCheck } from 'lucide-react';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import EmptyState from '../../components/ui/EmptyState';
import InlineAlert from '../../components/ui/InlineAlert';
import ScreenHeader from '../../components/ui/ScreenHeader';
import { ListSkeleton } from '../../components/ui/Skeleton';
import { NAV_OFFSET } from '../../components/BottomNav';
import useFadeIn from '../../utils/useFadeIn';
import {
    activeUndo,
    companiesLabel,
    formatCleanupDate,
    groupProposals,
    keysToSend,
    operationsLabel,
    selectAll,
    selectedOperations,
    selectionState,
    toggleKey,
    toggleKeys,
    undoDeadline,
} from '../../utils/cleanupReview';

// «Ещё → Старые описания»: разовая чистка описаний, внесенных до появления
// компаний (сервер - /api/description-cleanup, логика выбора -
// utils/cleanupReview). Экран показывает одно из состояний по последнему
// прогону:
//   нет прогона / отменен / не удался -> объяснение и кнопка «Разобрать»;
//   submitted -> Claude разбирает пакет, можно закрыть приложение;
//   ready     -> проверка списка с флажками и кнопка «Применить к N операциям»;
//   applied   -> итог и «Отменить чистку» (пока не вышел срок).
// Данные и действия приходят снаружи. Состояние внутри - только то, что нужно
// виду: выбранные ключи, идущее действие, ошибка и сообщение о результате.
// Действия (onStart, onApply, onRevert) возвращают { ok, error, data }.

const stackStyle = { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' };
const mutedText = { margin: 0, color: 'var(--color-text-muted)', fontSize: 'var(--text-md)' };
const sectionHeadingStyle = {
    margin: 0,
    padding: '0 var(--space-1)',
    fontSize: 'var(--text-sm)',
    fontWeight: 'var(--weight-label)',
    color: 'var(--color-text-muted)',
};
const dividerStyle = { borderTop: '1px solid var(--color-border-subtle)' };

// Флажок с подписью: настоящий input внутри label, нажимается вся строка
// (не меньше 44px). mixed рисует «часть выбрана» у общего флажка блока.
function CheckRow({ checked, mixed = false, onChange, count, indent = false, children }) {
    const inputRef = useRef(null);
    useEffect(() => {
        if (inputRef.current) inputRef.current.indeterminate = mixed;
    }, [mixed]);

    return (
        <label
            style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 'var(--space-3)',
                minHeight: '44px',
                padding: `var(--space-3) var(--space-4)`,
                paddingLeft: indent ? 'var(--space-8)' : 'var(--space-4)',
                boxSizing: 'border-box',
                cursor: 'pointer',
            }}
        >
            <input
                ref={inputRef}
                type="checkbox"
                checked={checked}
                onChange={onChange}
                style={{
                    flexShrink: 0,
                    width: '22px',
                    height: '22px',
                    margin: '1px 0 0',
                    accentColor: 'var(--color-primary)',
                }}
            />
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-0-5)' }}>
                {children}
            </span>
            {count != null && (
                <span style={{ flexShrink: 0, color: 'var(--color-text-muted)', fontSize: 'var(--text-base)', whiteSpace: 'nowrap', paddingTop: '2px' }}>
                    {operationsLabel(count)}
                </span>
            )}
        </label>
    );
}

const wrap = { overflowWrap: 'anywhere' };
const subLine = { ...wrap, color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-text)' };

function ProposalLabel({ proposal, withNote = false }) {
    const others = (proposal.variants || []).filter(variant => variant !== proposal.text);
    return (
        <>
            <span style={{ ...wrap, fontSize: 'var(--text-lg)' }}>{proposal.text}</span>
            {others.length > 0 && <span style={subLine}>также: {others.join(', ')}</span>}
            {withNote && proposal.note && <span style={subLine}>останется комментарий: {proposal.note}</span>}
        </>
    );
}

function CompanyBlock({ group, selected, onToggleGroup, onToggleKey }) {
    const state = selectionState(selected, group.keys);
    return (
        <Card as="div" tone="plain" padding="none" role="group" aria-label={`Компания ${group.name}`} style={{ overflow: 'hidden' }}>
            <CheckRow checked={state === 'all'} mixed={state === 'some'} onChange={() => onToggleGroup(group.keys)} count={group.count}>
                <span style={{ ...wrap, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-strong)' }}>
                    {group.name}
                    {group.isNew && (
                        <span
                            style={{
                                padding: '1px var(--space-2)',
                                borderRadius: 'var(--radius-pill)',
                                background: 'var(--color-primary-tint)',
                                color: 'var(--color-primary)',
                                fontSize: 'var(--text-xs)',
                                fontWeight: 'var(--weight-label)',
                            }}
                        >
                            новая
                        </span>
                    )}
                </span>
            </CheckRow>
            {group.items.map(item => (
                <div key={item.key} style={dividerStyle}>
                    <CheckRow checked={selected.has(item.key)} onChange={() => onToggleKey(item.key)} count={item.count} indent>
                        <ProposalLabel proposal={item} withNote />
                    </CheckRow>
                </div>
            ))}
        </Card>
    );
}

// Отмена последней применённой чистки. Показывается во всех состояниях, пока срок
// не вышел: новый разбор ее не прячет. main - основное содержимое после применения,
// section - отдельный блок внизу, когда на экране идет или ждет проверки другой разбор.
function UndoBlock({ undo, variant, today, lastApply, pending, confirming, setConfirming, onRevert, error }) {
    const counts = undo.stats?.apply || (variant === 'main' ? lastApply : null) || null;
    const updated = Number(counts?.updated) || 0;
    const created = Number(counts?.companiesCreated) || 0;
    const skipped = variant === 'main' ? Number(lastApply?.skippedChanged) || 0 : 0;
    const until = formatCleanupDate(undo.undoUntil, today);
    const done = counts
        ? `изменено ${operationsLabel(updated)}${created > 0 ? `, добавлено ${companiesLabel(created)}` : ''}`
        : null;
    const busy = Boolean(pending);

    return (
        <Card as="section" tone="plain" aria-label="Прошлая чистка" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {variant === 'main' ? (
                <>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                        <CircleCheck size={22} aria-hidden="true" color="var(--color-icon-green)" style={{ marginTop: '1px' }} />
                        <p style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-label)' }}>
                            {done ? `Готово: ${done}.` : 'Готово.'}
                        </p>
                    </div>
                    {skipped > 0 && (
                        <p style={mutedText}>{`${operationsLabel(skipped)} уже успели изменить - они не тронуты.`}</p>
                    )}
                    <p style={mutedText}>{`Отменить можно до ${until}.`}</p>
                </>
            ) : (
                <p style={{ margin: 0, fontSize: 'var(--text-md)' }}>
                    {`Прошлая чистка${done ? `: ${done}` : ''}. Отменить можно до ${until}.`}
                </p>
            )}

            {confirming === 'revert' ? (
                <div role="group" aria-label="Подтверждение отмены" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    <span style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--weight-label)' }}>
                        Вернуть описания как было? Операции, которые вы изменили после чистки, останутся как есть.
                    </span>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                        <Button tone="secondary" disabled={busy} onClick={() => setConfirming(null)}>Отмена</Button>
                        <Button tone="danger" disabled={busy} onClick={onRevert}>
                            {pending === 'revert' ? 'Возвращаем…' : 'Вернуть'}
                        </Button>
                    </div>
                </div>
            ) : (
                <Button tone="danger" block disabled={busy} onClick={() => setConfirming('revert')}>
                    {`Отменить чистку до ${until}`}
                </Button>
            )}
            {error}
        </Card>
    );
}

function Review({ run, today, pending, actionError, confirming, setConfirming, onApply, footer }) {
    const review = groupProposals(run.proposals);
    // Выбор привязан к прогону: новый прогон начинает с «выбрано всё», а повторное
    // чтение того же (например, при возврате в приложение) выбор не сбрасывает.
    const [selection, setSelection] = useState({ runId: null, keys: null });
    const selected = selection.runId === run.id && selection.keys ? selection.keys : selectAll(review);
    const update = (keys) => setSelection({ runId: run.id, keys });

    const noteKeys = review.notes.map(proposal => proposal.key);
    const operations = selectedOperations(selected, review);
    const keys = keysToSend(selected, review);
    const hasSelectable = review.companies.length > 0 || review.notes.length > 0;
    const allNotes = selectionState(selected, noteKeys) === 'all';
    const busy = pending === 'apply';
    const cancelRef = useRef(null);
    const barRef = useRef(null);
    const [barHeight, setBarHeight] = useState(0);

    // Высота панели меняется (подтверждение, сообщение об ошибке): запас под списком следует за ней.
    useLayoutEffect(() => {
        const node = barRef.current;
        if (!node) return undefined;
        const measure = () => setBarHeight(node.offsetHeight);
        measure();
        if (typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        return () => observer.disconnect();
    }, [hasSelectable]);

    useEffect(() => {
        if (confirming === 'apply') cancelRef.current?.focus();
    }, [confirming]);

    // Ничего не выбрано - подтверждать нечего.
    useEffect(() => {
        if (confirming === 'apply' && operations === 0) setConfirming(null);
    }, [confirming, operations, setConfirming]);

    return (
        <>
            <p style={mutedText}>
                Отметьте, что изменить. Ничего не изменится, пока вы не нажмете «Применить».
            </p>

            {review.companies.length > 0 && (
                <section aria-labelledby="cleanup-companies" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    <h2 id="cleanup-companies" style={sectionHeadingStyle}>Компании</h2>
                    {review.companies.map(group => (
                        <CompanyBlock
                            key={group.id}
                            group={group}
                            selected={selected}
                            onToggleGroup={groupKeys => update(toggleKeys(selected, groupKeys))}
                            onToggleKey={key => update(toggleKey(selected, key))}
                        />
                    ))}
                </section>
            )}

            {review.notes.length > 0 && (
                <section aria-labelledby="cleanup-notes" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                        <h2 id="cleanup-notes" style={sectionHeadingStyle}>Останутся описанием</h2>
                        <Button
                            tone="text"
                            size="sm"
                            onClick={() => update(toggleKeys(selected, noteKeys))}
                            style={{ minHeight: '44px', fontSize: 'var(--text-base)' }}
                        >
                            {allNotes ? 'Снять все' : 'Выбрать все'}
                        </Button>
                    </div>
                    <p style={{ ...mutedText, padding: '0 var(--space-1)', fontSize: 'var(--text-base)' }}>
                        У этих операций не будет компании, текст останется комментарием
                    </p>
                    <Card tone="plain" padding="none" style={{ overflow: 'hidden' }}>
                        {review.notes.map((proposal, index) => (
                            <div key={proposal.key} style={index > 0 ? dividerStyle : undefined}>
                                <CheckRow checked={selected.has(proposal.key)} onChange={() => update(toggleKey(selected, proposal.key))} count={proposal.count}>
                                    <ProposalLabel proposal={proposal} />
                                </CheckRow>
                            </div>
                        ))}
                    </Card>
                </section>
            )}

            {review.skipped.length > 0 && (
                <section aria-labelledby="cleanup-skipped" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    <h2 id="cleanup-skipped" style={sectionHeadingStyle}>Без ответа</h2>
                    <p style={{ ...mutedText, padding: '0 var(--space-1)', fontSize: 'var(--text-base)' }}>
                        Claude не ответил по этим описаниям, их можно разобрать позже
                    </p>
                    <Card as="ul" tone="plain" padding="none" style={{ listStyle: 'none', overflow: 'hidden' }}>
                        {review.skipped.map((proposal, index) => (
                            <li
                                key={proposal.key}
                                style={{
                                    ...(index > 0 ? dividerStyle : null),
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: 'var(--space-3)',
                                    padding: 'var(--space-3) var(--space-4)',
                                }}
                            >
                                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-0-5)' }}>
                                    <ProposalLabel proposal={proposal} />
                                </span>
                                <span style={{ flexShrink: 0, color: 'var(--color-text-muted)', fontSize: 'var(--text-base)', whiteSpace: 'nowrap' }}>
                                    {operationsLabel(proposal.count || 0)}
                                </span>
                            </li>
                        ))}
                    </Card>
                </section>
            )}

            {footer}

            {hasSelectable && (
                // Панель закреплена над нижней навигацией (position: fixed, как поле ввода в
                // «Вопросах»): sticky здесь не работает, потому что body с overflow-x: hidden
                // сам становится областью прокрутки. Чтобы панель не закрыла конец списка, под
                // списком стоит пустое место ее высоты.
                <>
                    <div aria-hidden="true" style={{ height: barHeight }} />
                    <div
                        ref={barRef}
                        style={{
                            position: 'fixed',
                            left: 0,
                            right: 0,
                            bottom: NAV_OFFSET,
                            zIndex: 700,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 'var(--space-3)',
                            // Снизу запас больше: кнопка «+» нижней панели выступает над ней.
                            padding: 'var(--space-3) var(--space-4) var(--space-5)',
                            borderTop: '1px solid var(--color-border-subtle)',
                            background: 'var(--color-surface)',
                        }}
                    >
                        {actionError && <InlineAlert tone="danger">{actionError}</InlineAlert>}
                        {confirming === 'apply' ? (
                            <div role="group" aria-label="Подтверждение" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                                <span style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--weight-label)' }}>
                                    {`Изменить ${operationsLabel(operations, 'accusative')}? Отменить можно до ${formatCleanupDate(undoDeadline(today), today)}.`}
                                </span>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                                    <Button ref={cancelRef} tone="secondary" disabled={busy} onClick={() => setConfirming(null)}>
                                        Отмена
                                    </Button>
                                    <Button disabled={busy} onClick={() => onApply(keys)}>
                                        {busy ? 'Применение…' : 'Изменить'}
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <Button block disabled={operations === 0 || busy} onClick={() => setConfirming('apply')}>
                                {`Применить к ${operationsLabel(operations, 'dative')}`}
                            </Button>
                        )}
                    </div>
                </>
            )}
        </>
    );
}

export default function CleanupScreen({ state, onBack, onRefresh, onStart, onApply, onRevert, now }) {
    const { summary, loading, error } = state;
    const [pending, setPending] = useState(null);
    const [actionError, setActionError] = useState('');
    const [notice, setNotice] = useState('');
    const [confirming, setConfirming] = useState(null);
    const [lastApply, setLastApply] = useState(null);
    const [checkedNote, setCheckedNote] = useState('');
    const today = now || new Date();

    // Вернулись в приложение - спросим сервер еще раз, не готов ли пакет. Без опроса по таймеру.
    const refreshRef = useRef(onRefresh);
    useEffect(() => { refreshRef.current = onRefresh; });
    useEffect(() => {
        const refresh = () => {
            if (document.visibilityState !== 'hidden') refreshRef.current?.();
        };
        window.addEventListener('focus', refresh);
        document.addEventListener('visibilitychange', refresh);
        return () => {
            window.removeEventListener('focus', refresh);
            document.removeEventListener('visibilitychange', refresh);
        };
    }, []);

    const run = summary?.run || null;
    const legacyCount = Number(summary?.legacyCount) || 0;

    const act = async (kind, task, onDone) => {
        if (pending) return;
        setPending(kind);
        setActionError('');
        try {
            const result = await task();
            if (result?.ok) onDone?.(result.data || {});
            else setActionError(result?.error || 'Не удалось выполнить действие.');
        } finally {
            setPending(null);
        }
    };

    const start = () => act('start', onStart, () => setNotice(''));
    const apply = (keys) => act('apply', () => onApply(keys), (data) => {
        setConfirming(null);
        setNotice('');
        setLastApply(data);
    });
    const revert = () => act('revert', onRevert, (data) => {
        setConfirming(null);
        setLastApply(null);
        const restored = Number(data.restored) || 0;
        const skipped = Number(data.skippedChanged) || 0;
        setNotice([
            `Возвращено ${operationsLabel(restored)}.`,
            skipped > 0 ? `${operationsLabel(skipped)} вы изменили после чистки - они не тронуты.` : '',
        ].filter(Boolean).join(' '));
    });
    const check = async () => {
        if (pending) return;
        setPending('check');
        setCheckedNote('');
        try {
            const ok = await onRefresh();
            if (ok) setCheckedNote(`Проверено в ${today.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}: пока не готово.`);
        } finally {
            setPending(null);
        }
    };

    const startButton = (label = 'Разобрать') => (
        <Button block disabled={Boolean(pending)} onClick={start}>
            {pending === 'start' ? 'Отправляем…' : label}
        </Button>
    );
    const actionAlert = actionError ? <InlineAlert tone="danger">{actionError}</InlineAlert> : null;

    // Отмена последней чистки не зависит от последнего прогона (ответ сервера: undo).
    const undo = summary ? activeUndo(summary, today) : null;
    const undoBlock = (variant, { inBar = false } = {}) => undo && (
        <UndoBlock
            undo={undo}
            variant={variant}
            today={today}
            lastApply={lastApply}
            pending={pending}
            confirming={confirming}
            setConfirming={(value) => { setActionError(''); setConfirming(value); }}
            onRevert={revert}
            error={inBar ? null : actionAlert}
        />
    );

    // Разбор проявляется, когда скелетон сменился данными. Ожидание - пока нет
    // summary: обновление поверх уже показанного скелетон не возвращает.
    // Без сдвига: внутри панель position: fixed.
    const bodyFade = useFadeIn(!summary, { flat: true });

    let body;
    if (!summary) {
        body = loading || !error ? <ListSkeleton label="Загрузка…" rows={3} amounts={false} /> : null;
    } else if (run?.status === 'ready') {
        body = (
            <Review
                run={run}
                today={today}
                pending={pending}
                actionError={actionError}
                confirming={confirming}
                setConfirming={setConfirming}
                onApply={apply}
                footer={undoBlock('section', { inBar: true })}
            />
        );
    } else if (run?.status === 'submitted') {
        body = (
            <>
                <Card tone="plain" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    <p style={{ margin: 0, fontSize: 'var(--text-lg)' }}>
                        Claude разбирает описания. Обычно это занимает до часа. Можно закрыть приложение и вернуться позже.
                    </p>
                    {checkedNote && <p role="status" style={mutedText}>{checkedNote}</p>}
                    <Button tone="secondary" disabled={Boolean(pending)} onClick={check}>
                        {pending === 'check' ? 'Проверяем…' : 'Проверить'}
                    </Button>
                </Card>
                {undoBlock('section')}
            </>
        );
    } else if (run?.status === 'applied' && undo) {
        body = (
            <>
                {undoBlock('main')}
                {legacyCount > 0 && (
                    <Card tone="plain" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                        <p style={{ margin: 0, fontSize: 'var(--text-lg)' }}>{`Осталось ${operationsLabel(legacyCount)} без компании`}</p>
                        {startButton()}
                    </Card>
                )}
            </>
        );
    } else if (legacyCount === 0) {
        body = (
            <>
                <EmptyState
                    icon={<BrushCleaning size={24} />}
                    title="Разбирать нечего"
                    description="У всех операций уже есть компания или заметка."
                />
                {undoBlock('section')}
                {actionAlert}
            </>
        );
    } else {
        body = (
            <>
                <Card tone="plain" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    {run?.status === 'failed' && (
                        <p role="status" style={{ margin: 0, color: 'var(--color-danger-text)', fontSize: 'var(--text-md)', fontWeight: 'var(--weight-label)' }}>
                            Прошлый разбор не удался
                        </p>
                    )}
                    <p style={{ margin: 0, fontSize: 'var(--text-lg)' }}>
                        {`У ${operationsLabel(legacyCount, 'genitive')}, внесенных до появления компаний, название магазина записано в описании. Claude предложит, какие из этих описаний - компании из справочника, какие - новые компании, а какие - просто заметки. Ничего не изменится, пока вы не просмотрите и не подтвердите список.`}
                    </p>
                    <p style={mutedText}>
                        Claude получит только тексты описаний, их категории и число операций, а также названия компаний из справочника. Суммы и даты не отправляются.
                    </p>
                    {actionAlert}
                    {startButton()}
                </Card>
                {undoBlock('section')}
            </>
        );
    }

    // Ошибка чтения: поверх уже показанных данных или вместо них.
    const loadFailure = error ? (
        <InlineAlert tone="danger" action={{ label: 'Повторить', onClick: onRefresh, disabled: loading }}>
            {error}
        </InlineAlert>
    ) : null;

    return (
        // Только прозрачность (flat): в теле есть панель position: fixed, и сдвиг
        // экрана увёл бы её с места на время анимации.
        <div className="screen-enter screen-enter--flat" style={stackStyle}>
            <ScreenHeader title="Старые описания" backLabel="Ещё" onBack={onBack} />
            {loadFailure}
            {notice && <InlineAlert tone="neutral">{notice}</InlineAlert>}
            {body && <div className={bodyFade} style={stackStyle}>{body}</div>}
        </div>
    );
}
