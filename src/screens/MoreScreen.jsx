import { useState } from 'react';
import { Building2, BrushCleaning, Download, Gauge, Landmark, RefreshCw, Tags, Trash2 } from 'lucide-react';
import Button from '../components/ui/Button';
import ListRow from '../components/ui/ListRow';
import ScreenHeader from '../components/ui/ScreenHeader';
import { cleanupRowSubtitle } from '../utils/cleanupReview';
import { formatMoney } from '../utils/money';
import { describeRequest, formatMs } from '../utils/loadTiming';

// Содержимое вкладки «Ещё»: настройки и служебные действия, собранные в
// группы по смыслу. Каждая группа - маленькая подпись и белая карточка со
// строками. Сам экран ничего не хранит и не загружает: значения и
// обработчики приходят от App.

const sectionStyle = { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' };

const captionStyle = {
  margin: 0,
  padding: '0 var(--space-1)',
  fontSize: 'var(--text-sm)',
  fontWeight: 'var(--weight-label)',
  color: 'var(--color-text-muted)',
};

// Отступ по бокам задаёт карточка, а не строки: линии-разделители тогда не
// доходят до краёв, как в нативных списках.
const groupStyle = {
  padding: '0 var(--space-4)',
  background: 'var(--color-surface)',
  borderRadius: 'var(--radius-lg)',
};

// Плитка с иконкой слева: квадрат 36px с тонированным фоном из токенов.
function Tile({ icon, color, background }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '36px',
        height: '36px',
        borderRadius: 'var(--radius-sm)',
        background,
        color,
      }}
    >
      {icon}
    </span>
  );
}

const muted = (value) => (
  <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-md)', marginRight: 'var(--space-1)' }}>
    {value}
  </span>
);

function Section({ id, title, children }) {
  return (
    <section aria-labelledby={id} style={sectionStyle}>
      <h2 id={id} style={captionStyle}>{title}</h2>
      <div style={groupStyle}>{children}</div>
    </section>
  );
}

const timingLineStyle = {
  padding: 'var(--space-2) 0',
  fontSize: 'var(--text-base)',
  fontVariantNumeric: 'tabular-nums',
  // Путь запроса без пробелов длинный: на узком экране он переносится, а не
  // раздвигает карточку.
  overflowWrap: 'anywhere',
};

const timingSubcaptionStyle = {
  margin: 0,
  padding: 'var(--space-2) 0 0',
  fontSize: 'var(--text-xs)',
  fontWeight: 'var(--weight-label)',
  color: 'var(--color-text-muted)',
};

function RequestList({ title, requests }) {
  if (requests.length === 0) return null;
  return (
    <>
      <h3 style={timingSubcaptionStyle}>{title}</h3>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {requests.map((request, index) => (
          <li key={`${request.startTime}-${index}`} style={timingLineStyle}>{describeRequest(request)}</li>
        ))}
      </ul>
    </>
  );
}

// Замер читается один раз при открытии экрана (он монтируется заново при
// каждом входе во вкладку) и по кнопке: без опроса и без хранения.
function LoadTimingSection({ readTiming }) {
  const [timing, setTiming] = useState(() => readTiming());
  const { page, dataReadyAt, startupRequests, recentRequests } = timing;

  return (
    <Section id="more-timing" title="Скорость загрузки">
      <div style={{ padding: 'var(--space-2) 0 var(--space-3)' }}>
        <div style={timingLineStyle}>
          {page?.responseStart != null
            ? `Страница: ${formatMs(page.responseStart)}${page.fromCache ? ' (из кеша)' : ''}`
            : 'Страница: нет данных'}
        </div>
        <div style={timingLineStyle}>
          {dataReadyAt != null
            ? `Первые данные: ${formatMs(dataReadyAt)} после запуска`
            : 'Первые данные: еще не получены'}
        </div>
        <RequestList title="Запросы при запуске" requests={startupRequests} />
        <RequestList title="Последние запросы" requests={recentRequests} />
        <Button
          tone="text"
          size="sm"
          aria-label="Обновить замеры"
          onClick={() => setTiming(readTiming())}
          style={{ marginTop: 'var(--space-2)' }}
        >
          Обновить
        </Button>
      </div>
    </Section>
  );
}

export default function MoreScreen({
  monthlyLimit,
  accountsCount,
  categoriesCount,
  trashCount,
  lastSyncLabel,
  isRefreshing,
  isExporting,
  onOpenLimit,
  onOpenAccounts,
  onOpenCategories,
  onOpenTrash,
  cleanupSummary = null,
  onOpenCleanup,
  onOpenBanking,
  pendingBankingCount = 0,
  onRefresh,
  onExport,
  onLogout,
  readLoadTiming,
}) {
  const hasLimit = Number(monthlyLimit) > 0;
  const hasTrashCount = typeof trashCount === 'number';
  // Строка «Старые описания» есть, только когда App передал onOpenCleanup (включена
  // функция) и сервер сообщил, что есть что разбирать, проверять или отменять.
  const cleanupSubtitle = onOpenCleanup ? cleanupRowSubtitle(cleanupSummary) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <ScreenHeader title="Ещё" />

      <Section id="more-budget" title="Бюджет">
        <ListRow
          leading={<Tile icon={<Gauge size={18} />} color="var(--color-primary)" background="var(--color-primary-tint)" />}
          title="Лимит трат в месяц"
          trailing={muted(hasLimit ? formatMoney(monthlyLimit, { whole: true }) : 'Не задан')}
          chevron
          onClick={onOpenLimit}
        />
      </Section>

      <Section id="more-ledger" title="Учёт">
        <ListRow
          leading={<Tile icon={<Landmark size={18} />} color="var(--color-icon-teal)" background="var(--color-icon-teal-bg)" />}
          title="Счета"
          trailing={accountsCount != null ? muted(accountsCount) : null}
          chevron
          divider
          onClick={onOpenAccounts}
        />
        <ListRow
          leading={<Tile icon={<Tags size={18} />} color="var(--color-icon-purple)" background="var(--color-icon-purple-bg)" />}
          title="Категории"
          trailing={categoriesCount != null ? muted(categoriesCount) : null}
          chevron
          divider
          onClick={onOpenCategories}
        />
        <ListRow
          leading={<Tile icon={<Trash2 size={18} />} color="var(--color-icon-orange)" background="var(--color-icon-orange-bg)" />}
          title="Корзина"
          subtitle="Удалённые операции можно восстановить"
          trailing={hasTrashCount ? muted(trashCount) : null}
          chevron
          divider={Boolean(cleanupSubtitle || onOpenBanking)}
          onClick={onOpenTrash}
        />
        {cleanupSubtitle && (
          <ListRow
            leading={<Tile icon={<BrushCleaning size={18} />} color="var(--color-icon-pink)" background="var(--color-icon-pink-bg)" />}
            title="Старые описания"
            subtitle={cleanupSubtitle}
            chevron
            divider={Boolean(onOpenBanking)}
            onClick={onOpenCleanup}
          />
        )}
        {/* Банковский модуль остаётся в коде без входа в интерфейсе: строка
            есть только когда App передал onOpenBanking (включён флаг). */}
        {onOpenBanking && (
          <ListRow
            leading={<Tile icon={<Building2 size={18} />} color="var(--color-primary)" background="var(--color-primary-tint)" />}
            title="Банки"
            trailing={pendingBankingCount > 0 ? muted(`предложений: ${pendingBankingCount}`) : null}
            chevron
            onClick={onOpenBanking}
          />
        )}
      </Section>

      <Section id="more-data" title="Данные">
        {/* Строка без onClick: кнопка «Обновить» лежит внутри неё, а вложенные
            кнопки недопустимы, поэтому нажимается не вся строка, а только она. */}
        <ListRow
          leading={<Tile icon={<RefreshCw size={18} />} color="var(--color-icon-green)" background="var(--color-icon-green-bg)" />}
          title="Синхронизировано"
          subtitle={lastSyncLabel || 'Ещё не синхронизировано'}
          divider
          trailing={(
            <Button tone="secondary" size="sm" onClick={onRefresh} disabled={isRefreshing}>
              {isRefreshing ? 'Обновление…' : 'Обновить'}
            </Button>
          )}
        />
        <ListRow
          leading={<Tile icon={<Download size={18} />} color="var(--color-icon-amber)" background="var(--color-icon-amber-bg)" />}
          title={isExporting ? 'Экспорт…' : 'Выгрузить в CSV'}
          onClick={onExport}
          disabled={isExporting}
          style={isExporting ? { opacity: 0.6, cursor: 'default' } : undefined}
        />
      </Section>

      {readLoadTiming && <LoadTimingSection readTiming={readLoadTiming} />}

      <Button
        tone="text"
        block
        onClick={onLogout}
        style={{
          minHeight: '48px',
          background: 'var(--color-surface)',
          borderRadius: 'var(--radius-lg)',
          color: 'var(--color-danger)',
        }}
      >
        Выйти
      </Button>
    </div>
  );
}
