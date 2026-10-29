import { Fragment, useEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronRight, Square } from 'lucide-react';
import { AnswerBubble, ErrorBubble, UserBubble, WorkingBubble } from '../components/AskBubbles';
import { NAV_OFFSET } from '../components/BottomNav';
import Button from '../components/ui/Button';
import ScreenHeader from '../components/ui/ScreenHeader';
import './AskScreen.css';

// Внутренний экран «Аналитика → Вопросы к данным»: чат, в котором Claude
// отвечает по операциям человека. Сам разговор и запросы живут в App
// (utils/useAskConversation) - экран только показывает ходы и принимает
// вопросы, поэтому уход в Историю и возврат ничего не теряют.
//
// Поле ввода стоит над нижней панелью и не прокручивается; список ходов - лог:
// читалка озвучивает новые реплики, не перебивая.

const EXAMPLES = [
  'Сколько я потратил на кафе в этом месяце?',
  'На что ушло больше всего в сентябре?',
  'Сравни транспорт этим летом и прошлым',
  'Самые крупные покупки за месяц',
];

const MIN_QUESTION_LENGTH = 2;
const MAX_QUESTION_LENGTH = 500;
// Высота поля ввода (кнопка 40px, отступы по 10px и верхняя линия) и воздух над
// ним: последняя реплика не должна прятаться под полем.
const COMPOSER_HEIGHT = 61;

const mutedText = { margin: 0, color: 'var(--color-text-muted)' };

function Examples({ onPick }) {
  return (
    <section aria-label="Примеры вопросов" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-label)' }}>Например</span>
      {EXAMPLES.map((example) => (
        <button
          key={example}
          type="button"
          onClick={() => onPick(example)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-3)',
            width: '100%',
            minHeight: '52px',
            padding: '0 var(--space-4)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-surface)',
            color: 'var(--color-text-main)',
            font: 'inherit',
            fontSize: 'var(--text-md)',
            textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          {example}
          <ChevronRight size={18} color="var(--color-text-subtle)" aria-hidden="true" />
        </button>
      ))}
    </section>
  );
}

export default function AskScreen({ turns, onSend, onRetry, onStop, onReset, onBack, onOpenHistory }) {
  const [draft, setDraft] = useState('');
  const endRef = useRef(null);
  const last = turns.at(-1);
  const busy = last?.status === 'working';
  const hasTurns = turns.length > 0;

  // Новая реплика или шаг - прокрутка к концу. scrollIntoView есть не везде
  // (jsdom): без него просто остаёмся на месте.
  useEffect(() => {
    if (hasTurns) endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [turns, hasTurns]);

  const send = (question) => {
    if (onSend(question)) setDraft('');
  };

  const submit = (event) => {
    event.preventDefault();
    if (busy) return;
    send(draft.trim());
  };

  const stop = () => {
    // Вопрос возвращается в поле: его можно поправить и отправить снова.
    const question = onStop();
    if (question) setDraft(question);
  };

  const canSend = draft.trim().length >= MIN_QUESTION_LENGTH;

  return (
    <>
      <ScreenHeader
        title="Вопросы к данным"
        backLabel="Аналитика"
        onBack={onBack}
        actions={hasTurns ? (
          <Button
            tone="text"
            onClick={onReset}
            disabled={busy}
            style={{
              minHeight: '44px',
              padding: '0 var(--space-1)',
              fontSize: 'var(--text-md)',
              fontWeight: 'var(--weight-label)',
            }}
          >
            Новый разговор
          </Button>
        ) : undefined}
      />

      {!hasTurns && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
          <p style={{ ...mutedText, fontSize: 'var(--text-base)', lineHeight: 1.5 }}>
            Claude ищет ответ в ваших операциях. Суммы считает приложение теми же правилами, что и на экранах, а Claude только выбирает, что посчитать, и объясняет.
          </p>
          <Examples onPick={send} />
          <p style={{ ...mutedText, fontSize: 'var(--text-xs)', lineHeight: 1.5 }}>
            В Claude уходят итоги и найденные операции, но не вся история целиком. Разговор не сохраняется.
          </p>
        </div>
      )}

      <div
        role="log"
        aria-live="polite"
        aria-label="Разговор"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-4)',
          marginTop: hasTurns ? 'var(--space-4)' : 0,
          paddingBottom: `${COMPOSER_HEIGHT + 16}px`,
        }}
      >
        {turns.map((turn) => (
          <Fragment key={turn.id}>
            <UserBubble>{turn.question}</UserBubble>
            {turn.status === 'working' && <WorkingBubble steps={turn.steps} />}
            {turn.status === 'done' && <AnswerBubble answer={turn.answer} onOpenHistory={onOpenHistory} />}
            {turn.status === 'error' && (
              <ErrorBubble
                message={turn.error}
                // Повторить можно только последний вопрос: за ним ничего не ушло.
                onRetry={turn === last ? () => onRetry(turn.id) : undefined}
              />
            )}
          </Fragment>
        ))}
        {/* Конец списка: при прокрутке он встаёт над полем ввода и нижней панелью,
            а не под ними (обе fixed и перекрывают низ страницы). */}
        <div ref={endRef} style={{ scrollMarginBottom: `calc(${NAV_OFFSET} + ${COMPOSER_HEIGHT + 16}px)` }} />
      </div>

      <form
        aria-label="Вопрос"
        onSubmit={submit}
        className="ask-composer"
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: NAV_OFFSET,
          zIndex: 700,
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: '10px var(--space-4)',
          borderTop: '1px solid var(--color-border-subtle)',
          background: 'var(--color-surface)',
        }}
      >
        <label htmlFor="ask-question" className="ask-sr-only">Вопрос</label>
        <input
          id="ask-question"
          className="ask-input"
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          readOnly={busy}
          maxLength={MAX_QUESTION_LENGTH}
          autoComplete="off"
          enterKeyHint="send"
          placeholder={busy ? 'Claude отвечает…' : hasTurns ? 'Уточните или спросите ещё' : 'Спросите о расходах'}
        />
        {/* У кнопок разные key: они стоят на одном месте, и без них React
            переиспользовал бы один элемент, сменив ему type на submit прямо в
            обработчике клика, - тот же клик отправил бы форму. */}
        {busy ? (
          <button key="stop" type="button" onClick={stop} aria-label="Остановить" className="ask-send ask-send--stop">
            <Square size={14} fill="currentColor" aria-hidden="true" />
          </button>
        ) : (
          <button key="send" type="submit" disabled={!canSend} aria-label="Спросить" className="ask-send">
            <ArrowUp size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </form>
    </>
  );
}
