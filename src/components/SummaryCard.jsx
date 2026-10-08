// Карточка сводки за период: расход крупно (для месяца - над полосой
// лимита), под ним доход и сальдо. Вынесена из App.jsx, когда месяцы стали
// каруселью: таких карточек теперь на экране столько, сколько месяцев в
// истории, и рисовать их надо из одних и тех же данных, а не из состояния
// экрана.
//
// Интерактивна только активная карточка - её расход и доход открывают
// Историю с фильтром по типу. Это переход, а не переключатель: нажатого
// состояния у кнопок нет. У соседних те же цифры показываются обычным
// текстом, а нажатие на карточку целиком выбирает её месяц: две кнопки
// перехода на карточке, которая ещё даже не выбрана, спорили бы с этим
// жестом.

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
    fontWeight: 'var(--weight-strong)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
});

// Кнопка на активной карточке и просто блок на соседней. Разметка одна:
// иначе соседние карточки поехали бы на пиксель-другой относительно
// активной, и это было бы видно прямо во время свайпа.
function Pressable({ interactive, onClick, ariaLabel, style, children }) {
    if (!interactive) {
        return <div style={style}>{children}</div>;
    }
    return (
        <button type="button" onClick={onClick} aria-label={ariaLabel} style={style}>
            {children}
        </button>
    );
}

export default function SummaryCard({
    income,
    expense,
    monthlyLimit,
    // Полоса лимита рисуется только для месяца: у года и «всего времени»
    // месячный лимит ничего не означает.
    showLimitBar,
    // Подпись над суммой: обычный текст или, у активной карточки, кнопка
    // выбора периода. Она не может лежать внутри Pressable - кнопка в кнопке
    // невалидна, - поэтому подпись вынесена выше него.
    headline = 'Расход',
    // Открывает Историю с фильтром: onOpenHistory('income' | 'expense').
    onOpenHistory,
    isActive = true,
}) {
    const expenseAbs = Math.abs(expense);
    const saldo = income + expense;
    const incomeText = `+€${formatEuro(income)}`;
    const saldoText = `${saldo > 0 ? '+' : ''}€${formatEuro(saldo)}`;

    const isLimitUsable = Number.isFinite(monthlyLimit) && monthlyLimit > 0;
    const withLimitBar = showLimitBar && isLimitUsable;
    const limitRatio = isLimitUsable ? expenseAbs / monthlyLimit : 0;
    const isOverLimit = isLimitUsable && expenseAbs > monthlyLimit;
    const limitPercentDisplay = Number.isFinite(limitRatio) ? Math.round(limitRatio * 100) : 0;
    const limitBarWidthDisplay = Number.isFinite(limitRatio) ? Math.min(limitRatio * 100, 100) : 0;
    const limitRemaining = isLimitUsable ? monthlyLimit - expenseAbs : 0;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
                {/* Верхний отступ - тот, что раньше давали падинги Pressable
                    и блока суммы вокруг подписи: так подпись и сумма стоят
                    на прежних местах, хотя подпись теперь вне кнопки. */}
                <div style={{
                    textAlign: 'center',
                    padding: `${withLimitBar ? 'var(--space-1)' : 'calc(var(--space-1) + var(--space-2))'} 0 0`,
                    marginBottom: 'var(--space-1)',
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-text-muted)',
                    fontWeight: 'var(--weight-label)'
                }}>
                    {headline}
                </div>
                <Pressable
                    interactive={isActive}
                    onClick={() => onOpenHistory('expense')}
                    ariaLabel={`Расход: €${formatEuro(expenseAbs)}${withLimitBar ? ` из лимита €${monthlyLimit.toLocaleString('de-DE')}` : ''}, открыть историю расходов`}
                    style={{
                        alignSelf: withLimitBar ? 'stretch' : 'center',
                        background: 'transparent',
                        border: 'none',
                        // Без бокового отступа шкала встаёт вровень с плитками
                        // дохода и сальдо под ней. Сверху отступа нет: его
                        // роль играет подпись над кнопкой.
                        padding: withLimitBar ? '0 0 var(--space-1)' : '0 var(--space-1) var(--space-1)',
                        cursor: isActive ? 'pointer' : 'default',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 'var(--space-3)'
                    }}
                >
                    <div style={{ textAlign: 'center', padding: withLimitBar ? 0 : '0 0 var(--space-2)' }}>
                        <div data-account-value style={{ fontSize: '2rem', fontWeight: 'var(--weight-strong)', color: 'var(--color-text-main)' }}>
                            €{formatEuro(expenseAbs)}
                        </div>
                    </div>
                    {withLimitBar && (
                        <div style={{ width: '100%', boxSizing: 'border-box', textAlign: 'left' }}>
                            <div
                                aria-hidden="true"
                                style={{
                                    width: '100%',
                                    height: '8px',
                                    borderRadius: '999px',
                                    background: 'var(--color-surface-sunken)',
                                    overflow: 'hidden'
                                }}
                            >
                                <div
                                    data-account-value
                                    style={{
                                        width: `${limitBarWidthDisplay}%`,
                                        height: '100%',
                                        borderRadius: 'inherit',
                                        background: isOverLimit ? 'var(--color-negative)' : 'var(--color-primary)',
                                        transition: 'width 0.4s ease'
                                    }}
                                />
                            </div>
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                gap: 'var(--space-2)',
                                marginTop: 'var(--space-2)',
                                fontSize: 'var(--text-xs)'
                            }}>
                                <span data-account-value style={{ color: isOverLimit ? 'var(--color-negative)' : 'var(--color-text-muted)', fontWeight: 'var(--weight-label)', whiteSpace: 'nowrap' }}>
                                    {isOverLimit
                                        ? `сверх лимита €${formatEuro(Math.abs(limitRemaining))}`
                                        : `осталось €${formatEuro(limitRemaining)}`}
                                </span>
                                <span style={{ color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                                    <span data-account-value>{limitPercentDisplay}%</span> от €{monthlyLimit.toLocaleString('de-DE')}
                                </span>
                            </div>
                        </div>
                    )}
                </Pressable>
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                <Pressable
                    interactive={isActive}
                    onClick={() => onOpenHistory('income')}
                    ariaLabel={`Доход: €${formatEuro(income)}, открыть историю доходов`}
                    style={{
                        flex: 1,
                        textAlign: 'left',
                        background: 'var(--color-surface-muted)',
                        border: '1px solid var(--color-border-subtle)',
                        borderRadius: 'var(--radius-lg)',
                        padding: 'var(--space-3) var(--space-4)',
                        cursor: isActive ? 'pointer' : 'default',
                        transition: 'all 0.2s ease'
                    }}
                >
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-1)' }}>Доход</div>
                    <div data-account-value style={{ ...amountStyle(incomeText), color: 'var(--color-positive)' }}>
                        {incomeText}
                    </div>
                </Pressable>
                <div style={{
                    flex: 1,
                    background: 'var(--color-surface-muted)',
                    border: '1px solid var(--color-border-subtle)',
                    borderRadius: 'var(--radius-lg)',
                    padding: 'var(--space-3) var(--space-4)'
                }}>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-1)' }}>Сальдо</div>
                    <div data-account-value style={{ ...amountStyle(saldoText), color: saldo >= 0 ? 'var(--color-text-main)' : 'var(--color-negative)' }}>
                        {saldoText}
                    </div>
                </div>
            </div>
        </div>
    );
}
