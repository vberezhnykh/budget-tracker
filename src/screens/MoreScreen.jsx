import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import ListRow from '../components/ui/ListRow';
import ScreenHeader from '../components/ui/ScreenHeader';

// Временное меню «Ещё»: до этапа 6 всё, что раньше лежало за шестерёнкой в
// шапке, собрано в нём списком строк. Настройки пока открываются тем же
// модальным листом, что и раньше, - здесь только вход в него.

// Группа строк на белой карточке. Отступ по бокам задаёт карточка, а не
// строки: линии-разделители тогда не доходят до краёв, как в нативных
// списках.
const groupStyle = { padding: '0 var(--space-4)' };

export default function MoreScreen({
  lastSyncLabel,
  isRefreshing,
  isExporting,
  onOpenSettings,
  onOpenTrash,
  onRefresh,
  onExport,
  onLogout,
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <ScreenHeader title="Ещё" />

      <Card tone="plain" padding="none" style={groupStyle}>
        <ListRow title="Счета, категории и лимит" chevron divider onClick={onOpenSettings} />
        <ListRow title="Корзина" chevron onClick={onOpenTrash} />
      </Card>

      <Card tone="plain" padding="none" style={groupStyle}>
        {/* Строка без onClick: кнопка «Обновить» лежит внутри неё, а вложенные
            кнопки недопустимы, поэтому нажимается не вся строка, а только она. */}
        <ListRow
          title="Синхронизировано"
          subtitle={lastSyncLabel || 'Еще не синхронизировано'}
          divider
          trailing={(
            <Button tone="secondary" size="sm" onClick={onRefresh} disabled={isRefreshing}>
              Обновить
            </Button>
          )}
        />
        <ListRow
          title={isExporting ? 'Экспорт…' : 'Выгрузить в CSV'}
          onClick={onExport}
          disabled={isExporting}
        />
      </Card>

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
