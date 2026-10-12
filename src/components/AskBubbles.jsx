import { Fragment } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import Button from './ui/Button';
import { parseBold } from '../utils/askConversation';
import './AskBubbles.css';

// Реплики чата «Вопросы к данным»: вопрос человека, пузырь ожидания с шагами,
// ответ и ошибка. Текст ответа приходит от модели, поэтому показывается только
// как текст: **жирное** разбирает parseBold, HTML не вставляется нигде.

const bubbleBase = {
  fontSize: 'var(--text-lg)',
  overflowWrap: 'anywhere',
};

export function UserBubble({ children }) {
  return (
    <div
      style={{
        ...bubbleBase,
        alignSelf: 'flex-end',
        maxWidth: '80%',
        padding: '10px 14px',
        borderRadius: '18px 18px 4px 18px',
        background: 'var(--color-primary)',
        color: 'var(--color-text-inverse)',
        lineHeight: 1.4,
        whiteSpace: 'pre-wrap',
      }}
    >
      {children}
    </div>
  );
}

function StepRow({ done = false, children }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        color: done ? 'var(--color-text-muted)' : 'var(--color-text-main)',
        fontSize: 'var(--text-sm)',
        lineHeight: 1.4,
      }}
    >
      {done
        ? <Check size={16} strokeWidth={2.2} color="var(--color-positive)" aria-hidden="true" />
        : <LoaderCircle className="ask-spinner" size={16} strokeWidth={2.2} color="var(--color-primary)" aria-hidden="true" />}
      {done && <span className="ask-sr-only">Готово: </span>}
      <span>{children}</span>
    </div>
  );
}

// Пока Claude считает: по строке на каждый вызов инструмента, готовые с
// галочкой, текущий со спиннером. До первого шага и после последнего (ответ
// ещё пишется) - одна строка-ожидание.
export function WorkingBubble({ steps }) {
  const allDone = steps.length > 0 && steps.every((step) => step.done);
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        alignSelf: 'flex-start',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        maxWidth: '90%',
        padding: 'var(--space-3) 14px',
        borderRadius: '18px 18px 18px 4px',
        background: 'var(--color-surface)',
      }}
    >
      {steps.map((step, index) => (
        <StepRow key={index} done={step.done}>{step.label}</StepRow>
      ))}
      {steps.length === 0 && <StepRow>Думаю над вопросом</StepRow>}
      {allDone && <StepRow>Формулирую ответ</StepRow>}
    </div>
  );
}

function Paragraph({ text }) {
  return (
    <p style={{ margin: 0, whiteSpace: 'pre-line' }}>
      {parseBold(text).map((part, index) => (
        part.bold
          ? <strong key={index} style={{ fontWeight: 'var(--weight-strong)' }}>{part.text}</strong>
          : <Fragment key={index}>{part.text}</Fragment>
      ))}
    </p>
  );
}

function AnswerTable({ columns, rows }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="ask-table">
        <thead>
          <tr>
            {columns.map((column, index) => <th key={index} scope="col">{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AnswerBubble({ answer, onOpenHistory }) {
  const { blocks, basis, history } = answer;
  return (
    <article
      aria-label="Ответ"
      style={{
        ...bubbleBase,
        alignSelf: 'flex-start',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        width: '92%',
        padding: '14px',
        borderRadius: '18px 18px 18px 4px',
        background: 'var(--color-surface)',
        lineHeight: 1.5,
      }}
    >
      {blocks.map((block, index) => (
        block.type === 'table'
          ? <AnswerTable key={index} columns={block.columns} rows={block.rows} />
          : <Paragraph key={index} text={block.text} />
      ))}
      {(basis || history) && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-2)',
            paddingTop: '10px',
            borderTop: '1px solid var(--color-border-subtle)',
          }}
        >
          {basis && (
            <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', lineHeight: 1.4 }}>
              Посчитано: {basis}
            </span>
          )}
          {history && (
            <Button
              tone="secondary"
              size="sm"
              onClick={() => onOpenHistory(history)}
              style={{
                marginLeft: 'auto',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border-strong)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-primary)',
                fontWeight: 'var(--weight-label)',
              }}
            >
              Открыть в Истории
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

const FAILURE_TITLE = 'Не получилось ответить.';

// Сообщение сервера иногда само начинается с «Не получилось ответить.»: заголовок
// не повторяем.
export function ErrorBubble({ message, onRetry }) {
  const body = message.startsWith(FAILURE_TITLE) ? message.slice(FAILURE_TITLE.length).trim() : message;
  return (
    <div
      role="alert"
      style={{
        alignSelf: 'flex-start',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: '10px',
        maxWidth: '92%',
        padding: 'var(--space-3) 14px',
        borderRadius: '18px 18px 18px 4px',
        background: 'var(--color-danger-soft)',
        color: 'var(--color-danger-text)',
        fontSize: 'var(--text-md)',
        lineHeight: 1.45,
      }}
    >
      <p style={{ margin: 0 }}>
        <strong style={{ fontWeight: 'var(--weight-strong)' }}>{FAILURE_TITLE}</strong>
        {body ? ` ${body}` : ''}
      </p>
      {onRetry && (
        <Button
          tone="secondary"
          size="sm"
          onClick={onRetry}
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-danger-border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-danger-text)',
          }}
        >
          Повторить
        </Button>
      )}
    </div>
  );
}
