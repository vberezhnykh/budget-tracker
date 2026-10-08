import { ArrowRightLeft, Check, Minus, Plus } from 'lucide-react';
import AccountIcon from '../components/AccountIcon';
import PeriodPicker from '../components/PeriodPicker';
import SummaryCard from '../components/SummaryCard';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { formatPeriodPhrase } from '../utils/period';
import SummaryFrame from './SummaryFrame';
import '../components/AccountCards.css';

// Вкладка «Обзор»: шапка с каруселью счетов, быстрые действия и сводка за
// период. Разметка вынесена из App.jsx как есть; данные, обработчики и
// состояние остаются в App и приходят пропсами. Сводка в этот этап не
// менялась - её переделывает отдельный этап редизайна.
export default function OverviewScreen({
  lastSyncLabel,
  // Карусель счетов в шапке: callback-ref контейнера и обработчик прокрутки
  // из useSnapCarousel (объект хука целиком не передаётся - в нём ref'ы)
  setAccountContainer,
  onAccountScroll,
  slides,
  selectedAccount,
  onSlideClick,
  // Быстрые действия
  onAdd,
  // Сводка
  summaryFrame,
  timeRange,
  setMonthContainer,
  onMonthScroll,
  carouselMonths,
  monthlyTotals,
  selectedMonth,
  monthlyLimit,
  periodStats,
  onChangePeriod,
  onOpenHistory,
}) {
  return (
    <>
      {/* Premium Header */}
      <Card as="header" padding="lg" style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-8)' }}>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 'var(--weight-strong)', letterSpacing: '-0.8px', color: 'var(--color-primary)', margin: 0 }}>BudgetTracker</h1>
          {lastSyncLabel && (
            <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-2xs)', marginTop: 'var(--space-1)' }}>
              Синхронизировано: {lastSyncLabel}
            </div>
          )}
        </div>

        {/* Balance Carousel: total capital, type groups, then one slide per account */}
        <style>{`
          div::-webkit-scrollbar { display: none; }
        `}</style>
        <div
          ref={setAccountContainer}
          onScroll={onAccountScroll}
          data-testid="balance-carousel"
          style={{
            display: 'flex',
            overflowX: 'auto',
            scrollSnapType: 'x mandatory',
            WebkitOverflowScrolling: 'touch',
            gap: 'var(--space-3)',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none'
          }}
        >
          {/* Leading spacer: with center snap-alignment there is no slack before
              slide 0, so its centre snap position would need a negative scroll
              offset (impossible). This spacer supplies that slack so slide 0
              can still reach centre alignment at scrollLeft 0. Not a slide, so
              no data-carousel-slide - getCarouselSlideElements() must not see it. */}
          <div
            aria-hidden="true"
            style={{
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: 'max(0px, 6% - 12px)',
              pointerEvents: 'none'
            }}
          />
          {slides.map((slide, index) => {
            const isActive = slide.filter === selectedAccount;
            const balanceText = `€${slide.amount.toLocaleString('de-DE', { minimumFractionDigits: 2 })}`;
            return (
              <div
                key={slide.key}
                data-carousel-slide
                className="account-card"
                data-account-theme={slide.theme}
                role="button"
                tabIndex={0}
                aria-label={slide.note ? `${slide.name}: ${balanceText}, ${slide.note}` : `${slide.name}: ${balanceText}`}
                aria-current={isActive}
                aria-pressed={isActive}
                onClick={() => onSlideClick(slide, index)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSlideClick(slide, index);
                  }
                }}
              >
                {/* The account symbol sits in the card's top-right corner instead of
                    taking a full row of its own, so the card stays compact. It is
                    absolutely positioned and non-interactive: the name/amount block
                    below keeps the card's height, and centred text is unaffected. */}
                <div
                  aria-hidden="true"
                  className="account-card__symbol"
                >
                  <AccountIcon icon={slide.icon} type={slide.type} size={22} />
                </div>
                {isActive && <span aria-hidden="true" className="account-card__selection"><Check size={13} /></span>}
                <div className="account-card__name">
                  {slide.name}
                </div>
                <div className="balance-amount">
                  {balanceText}
                </div>
                {slide.note && (
                  <div className="account-card__note">
                    {slide.note}
                  </div>
                )}
              </div>
            );
          })}
          {/* Trailing spacer: mirrors the leading one so the last slide has
              equal slack after it and can also reach centre snap alignment. */}
          <div
            aria-hidden="true"
            style={{
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: 'max(0px, 6% - 12px)',
              pointerEvents: 'none'
            }}
          />
        </div>

        {/* Carousel dot indicators */}
        <div style={{ display: 'flex', flexWrap: 'nowrap', justifyContent: 'center', marginTop: 'var(--space-3)' }}>
          {slides.map((slide, index) => {
            const isActive = slide.filter === selectedAccount;
            return (
              <button
                key={slide.key}
                type="button"
                onClick={() => onSlideClick(slide, index)}
                aria-label={`Показать ${slide.name}`}
                aria-current={isActive}
                className="account-carousel-button"
                data-account-theme={slide.theme}
                style={{
                  // Hit target wants to be 40x40 for touch, but with many
                  // accounts a row of fixed 40px boxes no longer fits the
                  // width and used to wrap onto a second line. So the box is
                  // 40px wide at most and allowed to shrink (flexShrink: 1)
                  // down to 20px, which keeps every dot on one row up to
                  // ~16 accounts. The horizontal margin stays at 0 so the
                  // boxes tile edge-to-edge instead of overlapping (a
                  // negative horizontal margin here made a wider dot's box
                  // paint over its neighbour, so taps meant for one dot's
                  // visible marker landed on the next dot instead); only the
                  // vertical margin is pulled back, where there are no
                  // neighbours to overlap and it keeps the row from growing
                  // taller.
                  flexShrink: 1,
                  flexGrow: 0,
                  flexBasis: '40px',
                  maxWidth: '40px',
                  minWidth: '20px',
                  height: '40px',
                  margin: '-9px 0',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                <span className="account-carousel-dot" aria-hidden="true">
                  <svg width="18" height="8" viewBox="0 0 18 8" focusable="false">
                    <rect x={isActive ? 0 : 5} y="0" width={isActive ? 18 : 8} height="8" rx="4" fill="currentColor" />
                  </svg>
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      {/* Quick Actions */}
      <section style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <Button tone="positive" onClick={() => onAdd('income')} aria-label="Добавить доход" style={{ flex: 1, whiteSpace: 'nowrap' }}>
            <Plus size={18} /> Доход
          </Button>
          <Button tone="expense" onClick={() => onAdd('expense')} aria-label="Добавить расход" style={{ flex: 1, whiteSpace: 'nowrap' }}>
            <Minus size={18} /> Расход
          </Button>
          <Button tone="soft" onClick={() => onAdd('transfer')} aria-label="Добавить перевод" style={{ flex: 1, whiteSpace: 'nowrap' }}>
            <ArrowRightLeft size={18} /> Перевод
          </Button>
        </div>
      </section>

      {/* Единственный выбор периода на экране - не отдельная строка, а часть
          подписи сводки: «Расход за сентябрь ⌄» на карточке (месяц, год,
          всё время). Он стоит сразу под быстрыми действиями, поэтому у них
          тот же отступ снизу, что у шапки. */}
      {/* Summary Card with Budget Limit */}
      <SummaryFrame {...summaryFrame} skeleton={{ monthly: timeRange === 'month', limitBar: Number.isFinite(monthlyLimit) && monthlyLimit > 0, analytics: false }}>
        {timeRange === 'month' ? (
          /* Месяцы листаются так же, как счета в шапке: не «жест меняет
             данные», а лента карточек, которая едет за пальцем. Соседние
             месяцы видно по краям и приглушены, чтобы читалось, какой
             сейчас выбран. */
          <div
            ref={setMonthContainer}
            onScroll={onMonthScroll}
            data-testid="month-carousel"
            style={{
              display: 'flex',
              overflowX: 'auto',
              scrollSnapType: 'x mandatory',
              WebkitOverflowScrolling: 'touch',
              gap: 'var(--space-3)',
              scrollbarWidth: 'none',
              msOverflowStyle: 'none'
            }}
          >
            {/* Отступы по краям: при выравнивании по центру у первого и
                последнего слайда иначе не хватает слака, чтобы доехать до
                середины. Не слайды - без data-carousel-slide. */}
            <div aria-hidden="true" style={{ flex: '0 0 max(0px, 6% - 12px)', pointerEvents: 'none' }} />
            {carouselMonths.map((month) => {
              const totals = monthlyTotals[month] || { income: 0, expense: 0 };
              const isActive = month === selectedMonth;
              return (
                <Card
                  key={month}
                  data-carousel-slide
                  padding="lg"
                  style={{
                    flex: '0 0 88%',
                    scrollSnapAlign: 'center',
                    scrollSnapStop: 'always',
                    boxSizing: 'border-box',
                    // сверху отступ на ступень меньше, чем с остальных
                    // сторон, - высота слайда прежняя; пресет lg дал бы +4px
                    padding: 'var(--space-5) var(--space-6) var(--space-6)',
                    opacity: isActive ? 1 : 0.5,
                    transition: 'opacity 0.2s ease'
                  }}
                >
                  <SummaryCard
                    income={totals.income}
                    expense={totals.expense}
                    monthlyLimit={monthlyLimit}
                    showLimitBar
                    onOpenHistory={onOpenHistory}
                    isActive={isActive}
                    // Активная карточка - кнопка выбора периода, соседние -
                    // тот же текст про свой месяц, но обычный: триггер на
                    // карточке, которая ещё не выбрана, спорил бы с жестом
                    // выбора по нажатию на неё. Кнопка в DOM ровно одна.
                    headline={isActive
                      ? <PeriodPicker variant="inline" prefix="Расход за" timeRange={timeRange} selectedMonth={selectedMonth} onChange={onChangePeriod} />
                      : `Расход за ${formatPeriodPhrase('month', month)}`}
                  />
                </Card>
              );
            })}
            <div aria-hidden="true" style={{ flex: '0 0 max(0px, 6% - 12px)', pointerEvents: 'none' }} />
          </div>
        ) : (
          /* Год и «всё время» листать нечем - одна карточка без полосы лимита:
             месячный лимит для такого периода ничего не значит. */
          <Card padding="lg">
            <SummaryCard
              income={periodStats.income}
              expense={periodStats.expense}
              monthlyLimit={monthlyLimit}
              showLimitBar={false}
              headline={<PeriodPicker variant="inline" prefix="Расход за" timeRange={timeRange} selectedMonth={selectedMonth} onChange={onChangePeriod} />}
              onOpenHistory={onOpenHistory}
            />
          </Card>
        )}
      </SummaryFrame>
    </>
  );
}
