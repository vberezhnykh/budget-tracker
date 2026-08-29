import { useEffect, useRef, useState } from 'react';
import Chip from './ui/Chip'
import {
  getCurrentMonth,
  getLastMonthOfYear,
  formatMonthName,
  formatPeriodLabel,
  listPeriodMonths,
  listPeriodYears,
} from '../utils/period';

// The single period control, CoinKeeper-style: one "Период" chip instead of
// a month arrow row plus a separate Месяц/Год/Всё время segmented control.
// Tapping it opens a sheet that picks both the granularity and the concrete
// month/year, so the whole notion of "which period am I looking at" lives in
// one place and the header stays free of it.
export default function PeriodPicker({ timeRange, selectedMonth, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  // The granularity being previewed inside the open sheet. It only becomes
  // the app's timeRange once a concrete choice is made (or immediately, for
  // "Всё время", which has nothing further to pick).
  const [draftRange, setDraftRange] = useState(timeRange);
  const chipRef = useRef(null);

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
    chipRef.current?.focus();
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

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
      <button
        ref={chipRef}
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={`Период: ${formatPeriodLabel(timeRange, selectedMonth)}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-pill)',
          padding: '10px 16px',
          minHeight: '40px',
          color: 'var(--color-text-main)',
          fontSize: 'var(--text-base)',
          fontWeight: '700',
          cursor: 'pointer',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}
      >
        {formatPeriodLabel(timeRange, selectedMonth)}
        <span aria-hidden="true" style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)' }}>▼</span>
      </button>

      {isOpen && (
        <div
          onClick={close}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.35)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Выбор периода"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--color-surface)',
              width: '100%',
              maxWidth: '520px',
              maxHeight: '80vh',
              overflowY: 'auto',
              borderTopLeftRadius: '20px',
              borderTopRightRadius: '20px',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '18px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: 'var(--text-2xl)', fontWeight: '700' }}>Период</h3>
              <button
                type="button"
                onClick={close}
                aria-label="Закрыть"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--color-text-muted)',
                  fontSize: '1.4rem',
                  lineHeight: 1,
                  cursor: 'pointer',
                  padding: '4px 8px',
                }}
              >
                ×
              </button>
            </div>

            <div style={{ display: 'flex', gap: '4px', background: 'var(--color-surface-sunken)', padding: '4px', borderRadius: 'var(--radius-md)' }}>
              {[
                { id: 'month', label: 'Месяц' },
                { id: 'year', label: 'Год' },
                { id: 'lifetime', label: 'Всё время' },
              ].map(option => {
                const isActive = draftRange === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    // "Всё время" has nothing further to choose, so it
                    // applies and closes on the spot instead of leaving the
                    // sheet open with an empty body.
                    onClick={() => (option.id === 'lifetime' ? chooseLifetime() : setDraftRange(option.id))}
                    aria-pressed={isActive}
                    style={{
                      flex: 1,
                      background: isActive ? 'var(--color-surface)' : 'transparent',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      padding: '10px 8px',
                      color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
                      fontSize: 'var(--text-base)',
                      fontWeight: '600',
                      cursor: 'pointer',
                      boxShadow: isActive ? '0 2px 4px rgba(0,0,0,0.05)' : 'none',
                    }}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            {draftRange === 'month' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {years.map(year => (
                  <div key={year}>
                    <div style={{ fontSize: 'var(--text-xs)', fontWeight: '700', color: 'var(--color-text-muted)', letterSpacing: '0.5px', marginBottom: '8px' }}>
                      {year}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
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
                              padding: '12px 4px',
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
                        padding: '14px 16px',
                        fontSize: 'var(--text-md)',
                      }}
                    >
                      {year} год
                    </Chip>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
