import { Sparkles } from 'lucide-react';
import Card from './ui/Card';

// Вход в «Вопросы к данным» на экране «Аналитика»: поле-кнопка открывает чат, а
// две подсказки открывают его сразу с этим вопросом. Показывается, только когда
// на сервере задан ключ Claude (App передаёт onAsk лишь тогда).

const SUGGESTIONS = ['Сколько ушло на кафе?', 'Что выросло за месяц?'];

export default function AskCard({ onAsk }) {
  return (
    <Card
      as="section"
      aria-label="Вопрос к своим данным"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', borderRadius: 'var(--radius-lg)' }}
    >
      <button
        type="button"
        onClick={() => onAsk()}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          minHeight: '48px',
          padding: '0 14px',
          border: '1px solid var(--color-primary-border)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--color-primary-soft)',
          color: 'var(--color-text-muted)',
          font: 'inherit',
          fontSize: 'var(--text-lg)',
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <Sparkles size={18} color="var(--color-primary)" aria-hidden="true" />
        Спросить о своих расходах
      </button>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onAsk(suggestion)}
            style={{
              minHeight: '36px',
              padding: '0 var(--space-3)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-pill)',
              background: 'var(--color-surface-muted)',
              color: 'var(--color-text-main)',
              font: 'inherit',
              fontSize: 'var(--text-sm)',
              cursor: 'pointer',
            }}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </Card>
  );
}
