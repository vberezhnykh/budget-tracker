import { Check } from 'lucide-react';
import AccountStrip from '../components/AccountStrip';
import OverviewHero from '../components/OverviewHero';
import PeriodPicker from '../components/PeriodPicker';
import TransactionList from '../components/TransactionList';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { ListSkeleton } from '../components/ui/Skeleton';
import { getLatePlaque } from '../utils/latePlaque';
import { getCurrentMonth } from '../utils/period';
import useRecentTransactions from '../utils/useRecentTransactions';
import SummaryFrame from './SummaryFrame';

const ZERO_TOTALS = { income: 0, expense: 0 };

// Заголовок секции экрана: слева название, справа действие-ссылка.
// Высота строки 44px - кнопка справа остаётся достаточной для пальца, хотя
// сама она текстовая.
const SECTION_HEADER_STYLE = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-3)',
  minHeight: '44px',
};

const SECTION_TITLE_STYLE = {
  margin: 0,
  fontSize: 'var(--text-xl)',
  fontWeight: 'var(--weight-strong)',
};

const SECTION_ACTION_STYLE = {
  minHeight: '44px',
  padding: '0 var(--space-1)',
  fontSize: 'var(--text-base)',
  fontWeight: 'var(--weight-label)',
};

// Вкладка «Обзор» сверху вниз: выбор периода и статус синхронизации, главная
// карточка «расход из лимита», лента счетов, последние операции. Данные,
// обработчики и состояние остаются в App и приходят пропсами; свои здесь
// только последние операции - им нужен запрос, которого у остальных экранов
// нет, и жить он должен ровно пока вкладка открыта.
//
// Выбранный в ленте счёт относится ко всему Обзору: он фильтрует и итоги в
// главной карточке (через запрос в App), и список последних операций.
export default function OverviewScreen({
  // Готовая строка «Обновлено 14:05» или null, пока синхронизации не было
  syncStatus,
  slides,
  selectedAccount,
  onSelectAccount,
  onOpenAccountsSettings,
  summaryFrame,
  timeRange,
  selectedMonth,
  monthlyTotals,
  periodStats,
  monthlyLimit,
  typicalMonth,
  onChangePeriod,
  onOpenHistory,
  onOpenAllHistory,
  // Последние операции: запрос и счётчик обновления - те же, что у Истории
  request,
  historyRevision,
  openEditModal,
  getAccountDisplay,
  formatDate,
}) {
  const recent = useRecentTransactions({
    enabled: true,
    request,
    month: getCurrentMonth(),
    account: selectedAccount,
    revision: historyRevision,
  });

  // Месяц берётся из итогов по месяцам, а не из periodStats: они приходят
  // раньше деталей периода, и карточка не ждёт их лишний раз.
  const totals = timeRange === 'month' ? (monthlyTotals[selectedMonth] || ZERO_TOTALS) : periodStats;
  const plaque = getLatePlaque({
    timeRange,
    selectedMonth,
    spent: Math.abs(totals.expense),
    limit: monthlyLimit,
    typicalMonth,
  });

  const hasRecent = Object.keys(recent.groups).length > 0;

  return (
    <>
      {/* Заголовок экрана - сам выбор периода; названия приложения здесь нет. */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        columnGap: 'var(--space-3)',
        marginBottom: 'var(--space-3)',
      }}>
        <PeriodPicker variant="title" timeRange={timeRange} selectedMonth={selectedMonth} onChange={onChangePeriod} />
        {syncStatus && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', flexShrink: 0, fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
            <Check size={14} aria-hidden="true" style={{ color: 'var(--color-positive)' }} />
            {syncStatus}
          </div>
        )}
      </header>

      <SummaryFrame {...summaryFrame} skeleton={{ monthly: timeRange === 'month', limitBar: Number.isFinite(monthlyLimit) && monthlyLimit > 0, analytics: false }}>
        <OverviewHero
          timeRange={timeRange}
          selectedMonth={selectedMonth}
          income={totals.income}
          expense={totals.expense}
          monthlyLimit={monthlyLimit}
          plaque={plaque}
          onOpenHistory={onOpenHistory}
        />
      </SummaryFrame>

      <section aria-labelledby="overview-accounts" style={{ marginBottom: 'var(--space-6)' }}>
        <div style={SECTION_HEADER_STYLE}>
          <h2 id="overview-accounts" style={SECTION_TITLE_STYLE}>Счета</h2>
          <Button tone="text" onClick={onOpenAccountsSettings} style={SECTION_ACTION_STYLE}>Настроить</Button>
        </div>
        <AccountStrip slides={slides} selectedAccount={selectedAccount} onSelect={onSelectAccount} />
      </section>

      <section aria-labelledby="overview-recent">
        <div style={SECTION_HEADER_STYLE}>
          <h2 id="overview-recent" style={SECTION_TITLE_STYLE}>Последние операции</h2>
          <Button tone="text" onClick={onOpenAllHistory} style={SECTION_ACTION_STYLE}>Вся история</Button>
        </div>
        {/* Состояния «загрузка / ошибка / пусто» живут в своей белой
            карточке, а у самого списка внешней карточки нет: карточки в нём -
            это дни. */}
        {(recent.loading || recent.error || !hasRecent) && (
          <Card padding="none" style={{ overflow: 'hidden' }}>
            {recent.loading && (
              <div style={{ padding: 'var(--space-3) var(--space-4)' }}>
                <ListSkeleton label="Загрузка операций…" rows={3} />
              </div>
            )}
            {recent.error && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', padding: 'var(--space-4)', fontSize: 'var(--text-base)', color: 'var(--color-text-muted)' }}>
                <span role="alert">Не удалось загрузить операции</span>
                <Button tone="text" onClick={recent.retry} style={SECTION_ACTION_STYLE}>Повторить</Button>
              </div>
            )}
            {!recent.loading && !recent.error && !hasRecent && (
              <div style={{ padding: 'var(--space-4)', fontSize: 'var(--text-base)', color: 'var(--color-text-muted)' }}>
                Операций пока нет
              </div>
            )}
          </Card>
        )}
        {hasRecent && (
          <TransactionList
            groups={recent.groups}
            openEditModal={openEditModal}
            getAccountDisplay={getAccountDisplay}
            formatDate={formatDate}
          />
        )}
      </section>
    </>
  );
}
