import { ChevronRight } from 'lucide-react';
import Card from './ui/Card';
import InlineAlert from './ui/InlineAlert';
import { formatMonthName, formatPeriodPhrase, getCurrentMonth } from '../utils/period';
import { formatMoney } from '../utils/money';

// Главная карточка Обзора: расход за период одним крупным числом, под ним
// (для месяца) полоса лимита и остаток, затем доход и сальдо. Заменила
// SummaryCard: месяцы больше не листаются каруселью, карточка на экране одна,
// и рисуется она из итогов выбранного периода.
//
// Расход и доход открывают Историю с фильтром по типу. Это переход, а не
// переключатель: нажатого состояния у кнопок нет (ни aria-pressed, ни
// подсветки), а историю фильтр только открывает.

// Кнопка без вида кнопки: то, что нажимается, выглядит текстом карточки. Фон
// и рамка убраны, шрифт и цвет наследуются, а обводку фокуса отдаёт
// браузер - клавиатурному пользователю она нужна.
const bareButton = {
  display: 'block',
  padding: 0,
  background: 'transparent',
  border: 'none',
  font: 'inherit',
  color: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
};

// Знак и сумма - одно неразрывное целое: без nowrap браузер переносил строку
// по пробелу-по-смыслу, и «+» оставался висеть на строке один. Совсем длинные
// суммы (от миллиона) уходят на ступень ниже, а многоточие - последняя
// страховка, чтобы карточка не поехала.
const columnAmountStyle = (text) => ({
  fontSize: text.length > 11 ? 'var(--text-md)' : 'var(--text-xl)',
  fontWeight: 'var(--weight-strong)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

// Итог прошлого месяца под полосой в начале нового: «Октябрь закрыт: €6.890
// из €7.000» и вторая строка «Уложились, запас €110». Суммы в целых евро - это
// справка, а не учёт. Без пригодного лимита остаётся только первая строка.
// Есть onOpen - строка кнопка, нет - обычный блок.
function PreviousMonthRow({ previousMonth, monthlyLimit, onOpen }) {
  const spent = previousMonth.expense;
  const hasLimit = Number.isFinite(monthlyLimit) && monthlyLimit > 0;
  const isOver = hasLimit && spent > monthlyLimit;
  const title = `${formatMonthName(previousMonth.month)} закрыт: ${formatMoney(spent, { whole: true })}${hasLimit ? ` из ${formatMoney(monthlyLimit, { whole: true })}` : ''}`;
  const subtitle = hasLimit
    ? (isOver
      ? `Лимит превышен на ${formatMoney(spent - monthlyLimit, { whole: true })}`
      : `Уложились, запас ${formatMoney(monthlyLimit - spent, { whole: true })}`)
    : null;

  const content = (
    <>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-0-5)', minWidth: 0, flex: 1 }}>
        <span data-account-value style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--weight-label)', color: 'var(--color-text-main)' }}>
          {title}
        </span>
        {subtitle && (
          <span data-account-value style={{ fontSize: 'var(--text-sm)', color: isOver ? 'var(--color-negative)' : 'var(--color-text-muted)' }}>
            {subtitle}
          </span>
        )}
      </span>
      {onOpen && <ChevronRight size={18} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--color-text-muted)' }} />}
    </>
  );

  const rowStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    width: '100%',
    padding: 'var(--space-3)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--color-surface-inset)',
    textAlign: 'left',
  };

  if (!onOpen) return <div data-testid="previous-month-row" style={rowStyle}>{content}</div>;
  return (
    <button
      type="button"
      data-testid="previous-month-row"
      onClick={() => onOpen(previousMonth.month)}
      style={{ ...bareButton, ...rowStyle }}
    >
      {content}
    </button>
  );
}

export default function OverviewHero({
  timeRange,
  selectedMonth,
  income,
  // Со знаком, как приходит с сервера: расход отрицателен.
  expense,
  monthlyLimit,
  // Плашка конца месяца ({ title, text, tone }) или null - решает
  // utils/latePlaque, здесь она только рисуется.
  plaque = null,
  // Прошлый месяц для строки «закрыт» ({ month, expense } с положительным
  // расходом) или null; показывается только в начале нового месяца.
  previousMonth = null,
  // Нажатие на эту строку: onOpenPreviousMonth('2026-10'). Нет обработчика -
  // строка не кнопка.
  onOpenPreviousMonth,
  // Открывает Историю с фильтром: onOpenHistory('income' | 'expense').
  onOpenHistory,
}) {
  const expenseAbs = Math.abs(expense);
  const saldo = income + expense;
  const expenseText = formatMoney(expenseAbs);
  // Доход всегда с «+», даже нулевой: sign: 'auto' нуль оставил бы без знака.
  const incomeText = `+${formatMoney(income)}`;
  const saldoText = formatMoney(saldo, { sign: 'auto' });

  // Лимит месячный, поэтому полоса есть только у месяца; у года и «всего
  // времени» он ничего не значит. Негодный лимит (0, NaN) полосу тоже
  // отключает - иначе в процентах оказались бы NaN или Infinity.
  const isLimitUsable = Number.isFinite(monthlyLimit) && monthlyLimit > 0;
  const withLimit = timeRange === 'month' && isLimitUsable;
  const ratio = withLimit ? expenseAbs / monthlyLimit : 0;
  const isOverLimit = withLimit && expenseAbs > monthlyLimit;
  const percent = Number.isFinite(ratio) ? Math.round(ratio * 100) : 0;
  const barWidth = Number.isFinite(ratio) ? Math.min(ratio * 100, 100) : 0;
  const limitDelta = withLimit ? Math.abs(monthlyLimit - expenseAbs) : 0;
  // Месяц только начался: идущий месяц, трат ещё нет. Сумма тогда приглушена,
  // а вместо остатка и процентов - фраза, что весь лимит впереди.
  const isFreshMonth = timeRange === 'month' && selectedMonth === getCurrentMonth() && expenseAbs === 0;
  const limitText = withLimit ? `€${monthlyLimit.toLocaleString('de-DE')}` : '';

  // Для года фраза периода - просто «2026», с «годом» читается как в макете.
  const periodPhrase = `${formatPeriodPhrase(timeRange, selectedMonth)}${timeRange === 'year' ? ' год' : ''}`;

  return (
    <Card
      padding="none"
      style={{
        padding: 'var(--space-5)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-4)',
      }}
    >
      <div>
        <div style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)', fontWeight: 'var(--weight-label)', marginBottom: 'var(--space-1)' }}>
          Расход за {periodPhrase}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 'var(--space-2)' }}>
          <button
            type="button"
            onClick={() => onOpenHistory('expense')}
            aria-label={`Расход: ${formatMoney(expenseAbs)}${withLimit ? ` из лимита ${limitText}` : ''}, открыть историю расходов`}
            style={bareButton}
          >
            <span
              data-account-value
              style={{
                display: 'block',
                // Шесть цифр и больше («Расход за всё время») на узком экране
                // шли бы за край карточки - такие суммы уходят на ступень ниже.
                fontSize: expenseText.length > 10 ? 'calc(var(--text-display) * 0.75)' : 'var(--text-display)',
                fontWeight: 'var(--weight-strong)',
                lineHeight: 1.1,
                color: isFreshMonth ? 'var(--color-text-muted)' : 'var(--color-text-main)',
                whiteSpace: 'nowrap',
              }}
            >
              {expenseText}
            </span>
          </button>
          {withLimit && (
            <span style={{ fontSize: 'var(--text-md)', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
              из {limitText}
            </span>
          )}
        </div>
      </div>

      {withLimit && (
        <div>
          <div
            aria-hidden="true"
            data-testid="limit-bar"
            style={{
              height: '10px',
              borderRadius: 'var(--radius-pill)',
              background: 'var(--color-surface-sunken)',
              overflow: 'hidden',
            }}
          >
            <div
              data-account-value
              data-testid="limit-bar-fill"
              style={{
                width: `${barWidth}%`,
                height: '100%',
                borderRadius: 'inherit',
                background: isOverLimit ? 'var(--color-negative)' : 'var(--color-primary)',
                transition: 'width 0.4s ease',
              }}
            />
          </div>
          {isFreshMonth ? (
            <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-base)', color: 'var(--color-text-muted)' }}>
              Месяц только начался, весь лимит впереди
            </div>
          ) : (
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 'var(--space-2)',
              marginTop: 'var(--space-2)',
              fontSize: 'var(--text-base)',
              color: 'var(--color-text-muted)',
            }}>
              <span
                data-account-value
                style={{ whiteSpace: 'nowrap', color: isOverLimit ? 'var(--color-negative)' : undefined }}
              >
                {isOverLimit ? 'сверх лимита ' : 'осталось '}
                <strong style={{ fontWeight: 'var(--weight-strong)', color: isOverLimit ? 'inherit' : 'var(--color-text-main)' }}>
                  {formatMoney(limitDelta)}
                </strong>
              </span>
              <span data-account-value style={{ whiteSpace: 'nowrap' }}>{percent}%</span>
            </div>
          )}
        </div>
      )}

      {isFreshMonth && previousMonth && (
        <PreviousMonthRow previousMonth={previousMonth} monthlyLimit={monthlyLimit} onOpen={onOpenPreviousMonth} />
      )}

      {plaque && (
        <InlineAlert tone={plaque.tone} title={plaque.title}>
          {plaque.text}
        </InlineAlert>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: 'var(--space-3)',
        paddingTop: 'var(--space-4)',
        borderTop: '1px solid var(--color-border-subtle)',
      }}>
        <button
          type="button"
          onClick={() => onOpenHistory('income')}
          aria-label={`Доход: ${formatMoney(income)}, открыть историю доходов`}
          style={{ ...bareButton, minWidth: 0 }}
        >
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-1)' }}>Доход</div>
          <div data-account-value style={{ ...columnAmountStyle(incomeText), color: 'var(--color-positive)' }}>
            {incomeText}
          </div>
        </button>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-1)' }}>Сальдо</div>
          <div data-account-value style={{ ...columnAmountStyle(saldoText), color: saldo < 0 ? 'var(--color-negative)' : 'var(--color-text-main)' }}>
            {saldoText}
          </div>
        </div>
      </div>
    </Card>
  );
}
