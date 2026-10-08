import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';
import Chip from './ui/Chip'
import IconButton from './ui/IconButton'
import Sheet from './ui/Sheet'
import SegmentedControl from './ui/SegmentedControl'
import {
  getCurrentMonth,
  getLastMonthOfYear,
  formatMonthName,
  formatPeriodLabel,
  formatPeriodPhrase,
  formatPeriodTitle,
  listPeriodMonths,
  listPeriodYears,
} from '../utils/period';

// The single period control, CoinKeeper-style: one "Период" chip instead of
// a month arrow row plus a separate Месяц/Год/Всё время segmented control.
// Tapping it opens a sheet that picks both the granularity and the concrete
// month/year, so the whole notion of "which period am I looking at" lives in
// one place and the header stays free of it.
//
// Триггер бывает трёх видов. По умолчанию - чип «Период» (так его видит
// шторка истории с monthsOnly). variant="inline" - текстовая кнопка внутри
// подписи карточки: «{prefix} <период> ⌄». variant="title" - крупный
// заголовок экрана («Октябрь ⌄»), так выбор периода выглядит на Обзоре. Лист
// и логика выбора у них одни, отличается только то, что нажимают.
//
// У чипа есть два тона: светлый по умолчанию и tone="dark" - тёмная таблетка
// в шапке Аналитики.
export default function PeriodPicker({ timeRange, selectedMonth, onChange, monthsOnly = false, variant = 'chip', prefix = '', tone = 'light' }) {
  const [isOpen, setIsOpen] = useState(false);
  // The granularity being previewed inside the open sheet. It only becomes
  // the app's timeRange once a concrete choice is made (or immediately, for
  // "Всё время", which has nothing further to pick).
  const [draftRange, setDraftRange] = useState(timeRange);
  const chipRef = useRef(null);
  // Лист всегда уходит в body. Шторка истории трансформируется и скроллится,
  // а карточка сводки (Card tone glass) имеет backdrop-filter, и тот делает
  // её containing block для position:fixed потомков: лист внутри карточки
  // встал бы по её границам, а не по экрану. Из любого такого контекста
  // вложенный fixed-лист надо выводить наружу.
  const renderSheet = node => createPortal(node, document.body);

  const dark = tone === 'dark';
  const maxMonth = getCurrentMonth();
  const months = listPeriodMonths(maxMonth);
  const years = listPeriodYears(maxMonth);
  const selectedYear = selectedMonth.split('-')[0];

  const open = () => {
    setDraftRange(timeRange);
    setIsOpen(true);
  };

  const close = () => {
    setIsOpen(false);
    // Return focus to the control that opened the sheet, so keyboard and
    // screen-reader users don't get dropped back at the top of the page.
    chipRef.current?.focus({ preventScroll: true });
    // После выбора месяца активной становится другая карточка карусели, а
    // карточка, открывавшая лист, показывает период обычным текстом: её
    // триггер исчез. Фокус тогда переходит к триггеру новой активной карточки.
    // Ждём кадр - к этому моменту React уже перерисовал карусель.
    if (variant === 'inline') {
      requestAnimationFrame(() => {
        if (chipRef.current?.isConnected) return;
        document.querySelector('[data-period-trigger]')?.focus({ preventScroll: true });
      });
    }
  };

  const chooseMonth = (month) => {
    onChange({ timeRange: 'month', selectedMonth: month });
    close();
  };

  const chooseYear = (year) => {
    // Years are only offered when they contain at least one selectable
    // month, so this cannot come back null - but fall back to the current
    // selection rather than writing null into selectedMonth if it ever did.
    const month = getLastMonthOfYear(year, maxMonth) || selectedMonth;
    onChange({ timeRange: 'year', selectedMonth: month });
    close();
  };

  const chooseLifetime = () => {
    onChange({ timeRange: 'lifetime', selectedMonth });
    close();
  };

  return (
    <>
      {variant === 'title' ? (
        <button
          ref={chipRef}
          type="button"
          data-period-trigger
          onClick={open}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          // Видимый текст короче («Октябрь»), а доступное имя полное - как у
          // остальных триггеров, чтобы читалка называла и год.
          aria-label={`Период: ${formatPeriodLabel(timeRange, selectedMonth)}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--space-1-5)',
            minHeight: '44px',
            // Заголовок стоит у левого края экрана: боковой отступ убран,
            // чтобы текст встал вровень с карточками, а площадь нажатия
            // держит минимальная высота.
            padding: 0,
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-main)',
            fontFamily: 'inherit',
            fontSize: 'var(--text-title)',
            fontWeight: 'var(--weight-strong)',
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
            cursor: 'pointer',
          }}
        >
          {formatPeriodTitle(timeRange, selectedMonth)}
          <ChevronDown size={22} aria-hidden="true" style={{ color: 'var(--color-text-muted)' }} />
        </button>
      ) : variant === 'inline' ? (
        <button
          ref={chipRef}
          type="button"
          data-period-trigger
          onClick={open}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          aria-label={`Период: ${formatPeriodLabel(timeRange, selectedMonth)}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
            background: 'transparent',
            border: 'none',
            borderRadius: 'var(--radius-pill)',
            // Размер, цвет и насыщенность берутся у подписи, в которую кнопка
            // вставлена (карточка или заголовок «Сводки»). Отступы дают
            // кнопке площадь нажатия под палец (~36px в высоту при кегле
            // подписи), а равный им отрицательный margin оставляет текст ровно
            // там, где он стоял без кнопки. Снизу эта площадь заходит на
            // кнопку-фильтр с суммой - position и zIndex отдают перекрытие
            // подписи, сама сумма начинается ниже.
            padding: 'var(--space-3)',
            margin: 'calc(-1 * var(--space-3))',
            position: 'relative',
            zIndex: 1,
            font: 'inherit',
            color: 'inherit',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
          }}
        >
          <span>
            {prefix}{' '}
            <span style={{ color: 'var(--color-primary)' }}>{formatPeriodPhrase(timeRange, selectedMonth)}</span>
          </span>
          <ChevronDown size={14} style={{ color: 'var(--color-primary)' }} />
        </button>
      ) : (
      <button
        ref={chipRef}
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={`${monthsOnly ? 'Месяц истории' : 'Период'}: ${formatPeriodLabel(timeRange, selectedMonth)}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          background: dark ? 'var(--color-text-main)' : 'var(--color-surface)',
          border: dark ? '1px solid var(--color-text-main)' : '1px solid var(--color-border)',
          borderRadius: 'var(--radius-pill)',
          padding: dark ? 'var(--space-3) var(--space-3) var(--space-3) var(--space-4)' : 'var(--space-3) var(--space-4)',
          minHeight: '40px',
          whiteSpace: 'nowrap',
          color: dark ? 'var(--color-text-inverse)' : 'var(--color-text-main)',
          fontSize: 'var(--text-base)',
          fontWeight: 'var(--weight-strong)',
          cursor: 'pointer',
          boxShadow: dark ? 'none' : 'var(--shadow-xs)',
        }}
      >
        {formatPeriodLabel(timeRange, selectedMonth)}
        <ChevronDown size={16} style={{ color: dark ? 'var(--color-text-inverse)' : 'var(--color-text-muted)', opacity: dark ? 0.7 : 1 }} />
      </button>
      )}

      {isOpen && renderSheet(
        <Sheet ariaLabel={monthsOnly ? 'Переход к месяцу' : 'Выбор периода'} onClose={close} maxHeight="80vh">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-strong)' }}>{monthsOnly ? 'Переход к месяцу' : 'Период'}</h3>
              <IconButton round tone="neutral" onClick={close} aria-label="Закрыть"><X size={20} /></IconButton>
            </div>

            {!monthsOnly && (
              <SegmentedControl
                ariaLabel="Охват периода"
                size="lg"
                style={{ gap: 'var(--space-1)', background: 'var(--color-surface-sunken)' }}
                options={[
                  { id: 'month', label: 'Месяц' },
                  { id: 'year', label: 'Год' },
                  { id: 'lifetime', label: 'Всё время' },
                ]}
                value={draftRange}
                // "Всё время" has nothing further to choose, so it applies
                // and closes on the spot instead of leaving the sheet open
                // with an empty body.
                onChange={id => (id === 'lifetime' ? chooseLifetime() : setDraftRange(id))}
              />
            )}

            {draftRange === 'month' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                {years.map(year => (
                  <div key={year}>
                    <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-label)', color: 'var(--color-text-muted)', letterSpacing: '0.5px', marginBottom: 'var(--space-2)' }}>
                      {year}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-2)' }}>
                      {months.filter(m => m.startsWith(`${year}-`)).map(month => {
                        const isActive = timeRange === 'month' && month === selectedMonth;
                        return (
                          <Chip
                            key={month}
                            tone="quiet"
                            shape="block"
                            selected={isActive}
                            data-testid="period-month"
                            onClick={() => chooseMonth(month)}
                            style={{
                              padding: 'var(--space-3) var(--space-1)',
                              minHeight: '44px',
                              fontSize: 'var(--text-sm)',
                            }}
                          >
                            {formatMonthName(month)}
                          </Chip>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {draftRange === 'year' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {years.map(year => {
                  const isActive = timeRange === 'year' && year === selectedYear;
                  return (
                    <Chip
                      key={year}
                      tone="quiet"
                      shape="block"
                      selected={isActive}
                      onClick={() => chooseYear(year)}
                      style={{
                        textAlign: 'left',
                        padding: 'var(--space-4) var(--space-4)',
                        fontSize: 'var(--text-md)',
                      }}
                    >
                      {year} год
                    </Chip>
                  );
                })}
              </div>
            )}
        </Sheet>
      )}
    </>
  );
}
