// Карточка сводки за период: расход крупно (для месяца - внутри кольца
// лимита), под ним доход и сальдо. Вынесена из App.jsx, когда месяцы стали
// каруселью: таких карточек теперь на экране столько, сколько месяцев в
// истории, и рисовать их надо из одних и тех же данных, а не из состояния
// экрана.
//
// Интерактивна только активная карточка - её расход и доход переключают
// фильтр списка. У соседних те же цифры показываются обычным текстом, а
// нажатие на карточку целиком выбирает её месяц: две кнопки-фильтра на
// карточке, которая ещё даже не выбрана, спорили бы с этим жестом.

const formatEuro = (value) => value.toLocaleString('de-DE', { minimumFractionDigits: 2 });

// Знак и сумма - одно неразрывное целое. Без nowrap браузер переносил строку
// ровно по этому пробелу-по-смыслу, и «+» оставался висеть на строке один,
// а сумма уезжала под него.
//
// Кегль подобран с запасом, а не впритык: под сумму в этих боксах остаётся
// ~93px, и «+€8.649,42» прежним кеглем занимал 89 - то есть помещался на
// одном телефоне и не помещался на другом, где шрифт чуть шире. Тот же
// кегль стоит у этих чисел в «Сводке» на «Аналитике», так что заодно и
// одинаково. Совсем длинные суммы (от миллиона) уходят на ступень ниже, а
// многоточие - последняя страховка, чтобы карточка не поехала.
const amountStyle = (text) => ({
    fontSize: text.length > 11 ? 'var(--text-sm)' : 'var(--text-lg)',
    fontWeight: '700',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
});

// Кнопка на активной карточке и просто блок на соседней. Разметка одна:
// иначе соседние карточки поехали бы на пиксель-другой относительно
// активной, и это было бы видно прямо во время свайпа.
function Pressable({ interactive, onClick, ariaLabel, ariaPressed, style, children }) {
    if (!interactive) {
        return <div style={style}>{children}</div>;
    }
    return (
        <button type="button" onClick={onClick} aria-label={ariaLabel} aria-pressed={ariaPressed} style={style}>
            {children}
        </button>
    );
}

export default function SummaryCard({
    income,
    expense,
    monthlyLimit,
    // Кольцо лимита рисуется только для месяца: у года и «всего времени»
    // месячный лимит ничего не означает.
    showLimitRing,
    headlineLabel = 'Расход',
    selectedType,
    onToggleType,
    isActive = true,
}) {
    const expenseAbs = Math.abs(expense);
    const saldo = income + expense;
    const incomeText = `+€${formatEuro(income)}`;
    const saldoText = `${saldo > 0 ? '+' : ''}€${formatEuro(saldo)}`;

    const isLimitUsable = Number.isFinite(monthlyLimit) && monthlyLimit > 0;
    const withRing = showLimitRing && isLimitUsable;
    const limitRatio = isLimitUsable ? expenseAbs / monthlyLimit : 0;
    const isOverLimit = isLimitUsable && expenseAbs > monthlyLimit;
    const limitPercentDisplay = Number.isFinite(limitRatio) ? Math.round(limitRatio * 100) : 0;
    const limitBarWidthDisplay = Number.isFinite(limitRatio) ? Math.min(limitRatio * 100, 100) : 0;
    const limitRemaining = isLimitUsable ? monthlyLimit - expenseAbs : 0;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <Pressable
                interactive={isActive}
                onClick={() => onToggleType('expense')}
                ariaPressed={selectedType === 'expense'}
                ariaLabel={`Расход: €${formatEuro(expenseAbs)}${withRing ? ` из лимита €${monthlyLimit.toLocaleString('de-DE')}` : ''}`}
                style={{
                    alignSelf: 'center',
                    background: 'transparent',
                    border: 'none',
                    padding: '4px',
                    cursor: isActive ? 'pointer' : 'default',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '10px'
                }}
            >
                {withRing ? (
                    <div style={{ position: 'relative', width: '188px', height: '188px' }}>
                        <svg width="188" height="188" viewBox="0 0 188 188" aria-hidden="true" style={{ transform: 'rotate(-90deg)' }}>
                            <circle cx="94" cy="94" r="82" fill="none" stroke="var(--color-border-subtle)" strokeWidth="14" />
                            <circle
                                cx="94"
                                cy="94"
                                r="82"
                                fill="none"
                                stroke={isOverLimit ? 'var(--color-negative)' : 'var(--color-primary)'}
                                strokeWidth="14"
                                strokeLinecap="round"
                                strokeDasharray={2 * Math.PI * 82}
                                strokeDashoffset={2 * Math.PI * 82 * (1 - limitBarWidthDisplay / 100)}
                                style={{ transition: 'stroke-dashoffset 0.4s ease' }}
                            />
                        </svg>
                        <div style={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '2px'
                        }}>
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: '600' }}>Расход</div>
                            <div style={{ fontSize: '1.75rem', fontWeight: '800', color: 'var(--color-text-main)', lineHeight: 1.1 }}>
                                €{formatEuro(expenseAbs)}
                            </div>
                            <div style={{ fontSize: 'var(--text-xs)', color: isOverLimit ? 'var(--color-negative)' : 'var(--color-text-muted)', fontWeight: '600' }}>
                                {isOverLimit
                                    ? `сверх лимита €${formatEuro(Math.abs(limitRemaining))}`
                                    : `осталось €${formatEuro(limitRemaining)}`}
                            </div>
                            <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)' }}>
                                {limitPercentDisplay}% от €{monthlyLimit.toLocaleString('de-DE')}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div style={{ textAlign: 'center', padding: '8px 0' }}>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: '600', marginBottom: '4px' }}>
                            {headlineLabel}
                        </div>
                        <div style={{ fontSize: '2rem', fontWeight: '800', color: 'var(--color-text-main)' }}>
                            €{formatEuro(expenseAbs)}
                        </div>
                    </div>
                )}
                {isActive && selectedType === 'expense' && (
                    <span style={{ fontSize: 'var(--text-2xs)', fontWeight: '600', color: 'var(--color-primary)' }}>
                        список отфильтрован по расходам
                    </span>
                )}
            </Pressable>

            <div style={{ display: 'flex', gap: '12px' }}>
                <Pressable
                    interactive={isActive}
                    onClick={() => onToggleType('income')}
                    ariaPressed={selectedType === 'income'}
                    ariaLabel={`Доход: €${formatEuro(income)}`}
                    style={{
                        flex: 1,
                        textAlign: 'left',
                        background: isActive && selectedType === 'income' ? 'rgba(34, 197, 94, 0.12)' : 'var(--color-surface-muted)',
                        border: '1px solid',
                        borderColor: isActive && selectedType === 'income' ? '#4ade80' : 'var(--color-border-subtle)',
                        borderRadius: 'var(--radius-lg)',
                        padding: '12px 14px',
                        cursor: isActive ? 'pointer' : 'default',
                        transition: 'all 0.2s ease'
                    }}
                >
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: '2px' }}>Доход</div>
                    <div style={{ ...amountStyle(incomeText), color: 'var(--color-positive)' }}>
                        {incomeText}
                    </div>
                </Pressable>
                <div style={{
                    flex: 1,
                    background: 'var(--color-surface-muted)',
                    border: '1px solid var(--color-border-subtle)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '12px 14px'
                }}>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: '2px' }}>Сальдо</div>
                    <div style={{ ...amountStyle(saldoText), color: saldo >= 0 ? 'var(--color-text-main)' : 'var(--color-negative)' }}>
                        {saldoText}
                    </div>
                </div>
            </div>
        </div>
    );
}
