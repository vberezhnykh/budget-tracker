import { useId } from 'react';
import { ChevronRight, X } from 'lucide-react';
import Card from './ui/Card';
import IconButton from './ui/IconButton';
import { formatMoney } from '../utils/money';
import { monthGenitive } from '../utils/monthReview';

// Карточка «Итоги сентября» на Обзоре в первые дни нового месяца: заголовок и
// 2-4 пункта, которые написал сервер (server/monthReview.js). Данных и запросов
// здесь нет - только вид: App решает, показывать ли карточку, и отдаёт текст.
//
// Пункт с категорией - кнопка на всю ширину строки (не меньше 44px) с
// шевроном, как у других переходов: она открывает Историю с этой категорией.
// Пункт без категории - просто текст. Крестик в правом верхнем углу скрывает
// карточку; под него оставлено место справа от подписи и заголовка.
//
// Пока карточка на экране, она же подводит итог месяца для главной карточки:
// строки «Октябрь закрыт» там нет, а сумма и лимит стоят в подписи -
// «Итоги октября · €6.890 из €7.000». Суммы в целых евро, как в той строке.

const CLOSE_SIZE = 44;

const LABEL_STYLE = {
  margin: 0,
  fontSize: 'var(--text-base)',
  fontWeight: 'var(--weight-label)',
  color: 'var(--color-text-muted)',
};

const TITLE_STYLE = {
  margin: 'var(--space-1) 0 0',
  fontSize: 'var(--text-2xl)',
  fontWeight: 'var(--weight-strong)',
  lineHeight: 1.35,
  color: 'var(--color-text-main)',
};

const POINT_STYLE = {
  margin: 0,
  fontSize: 'var(--text-md)',
  fontWeight: 'var(--weight-text)',
  lineHeight: 1.4,
  color: 'var(--color-text-main)',
};

// spent - расход месяца обзора (положительный) или null, если он неизвестен;
// limit - месячный лимит или null: без пригодного лимита в подписи только сумма.
export default function MonthReviewCard({ month, spent = null, limit = null, headline, points, onOpenCategory, onDismiss }) {
  const titleId = useId();
  const hasLimit = Number.isFinite(limit) && limit > 0;
  let label = `Итоги ${monthGenitive(month)}`;
  if (Number.isFinite(spent)) {
    label += ` · ${formatMoney(spent, { whole: true })}${hasLimit ? ` из ${formatMoney(limit, { whole: true })}` : ''}`;
  }

  return (
    <Card
      as="section"
      aria-labelledby={titleId}
      data-testid="month-review-card"
      padding="none"
      style={{ position: 'relative', padding: 'var(--space-5)', marginBottom: 'var(--space-6)' }}
    >
      <div style={{ paddingRight: `${CLOSE_SIZE - 4}px` }}>
        <p style={LABEL_STYLE}>{label}</p>
        <h2 id={titleId} style={TITLE_STYLE}>{headline}</h2>
      </div>
      <IconButton
        size={CLOSE_SIZE}
        aria-label="Скрыть итоги месяца"
        onClick={onDismiss}
        style={{ position: 'absolute', top: 'var(--space-2)', right: 'var(--space-2)', color: 'var(--color-text-muted)' }}
      >
        <X size={20} aria-hidden="true" />
      </IconButton>
      <ul style={{ listStyle: 'none', margin: 'var(--space-2) 0 0', padding: 0 }}>
        {points.map((point, index) => (
          <li
            key={index}
            style={{ borderTop: index === 0 ? 'none' : '1px solid var(--color-border-subtle)' }}
          >
            {point.category ? (
              <button
                type="button"
                onClick={() => onOpenCategory(point.category)}
                style={{
                  ...POINT_STYLE,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  width: '100%',
                  minHeight: '44px',
                  padding: 'var(--space-2) 0',
                  boxSizing: 'border-box',
                  border: 'none',
                  background: 'transparent',
                  fontFamily: 'inherit',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>{point.text}</span>
                <ChevronRight size={18} aria-hidden="true" color="var(--color-text-subtle)" style={{ flexShrink: 0 }} />
              </button>
            ) : (
              <p style={{ ...POINT_STYLE, padding: 'var(--space-3) 0' }}>{point.text}</p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
