import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import AskScreen from './AskScreen';

const answerTurn = (overrides = {}) => ({
  id: 1,
  question: 'Сравни транспорт этим летом и прошлым',
  status: 'done',
  steps: [{ label: 'Транспорт, 1 июня – 31 августа 2026', done: true }],
  answer: {
    blocks: [
      { type: 'text', text: 'Этим летом на транспорт ушло **€412**, прошлым — **€538**.' },
      { type: 'table', columns: ['Месяц', '2026', '2025'], rows: [['Июнь', '€148', '€171'], ['Июль', '€131', '€205']] },
      { type: 'text', text: 'Больше всего разница в июле.' },
    ],
    basis: 'Транспорт, июнь – август 2025 и 2026',
    history: { category: 'Транспорт', account: null, type: 'expense', month: '2026-08' },
  },
  error: null,
  ...overrides,
});

const workingTurn = (steps = []) => ({ id: 2, question: 'На что ушло больше всего в сентябре?', status: 'working', steps, answer: null, error: null });
const errorTurn = (overrides = {}) => ({
  id: 3, question: 'На что ушло больше всего в сентябре?', status: 'error', steps: [], answer: null,
  error: 'Claude не ответил вовремя. Вопрос сохранен, его можно отправить еще раз.', ...overrides,
});

function setup(props = {}) {
  const handlers = {
    onSend: vi.fn(() => true),
    onRetry: vi.fn(),
    onStop: vi.fn(() => null),
    onReset: vi.fn(),
    onBack: vi.fn(),
    onOpenHistory: vi.fn(),
  };
  render(<AskScreen turns={[]} {...handlers} {...props} />);
  return handlers;
}

const input = () => screen.getByRole('textbox', { name: 'Вопрос' });

describe('AskScreen: empty conversation', () => {
  it('shows the header with a way back, the intro, four examples and the privacy note', () => {
    const { onBack } = setup();

    expect(screen.getByRole('heading', { level: 1, name: 'Вопросы к данным' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Аналитика' }));
    expect(onBack).toHaveBeenCalledTimes(1);

    expect(screen.getByText(/Claude ищет ответ в ваших операциях/)).toBeInTheDocument();
    const examples = within(screen.getByRole('region', { name: 'Примеры вопросов' }));
    expect(examples.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Сколько я потратил на кафе в этом месяце?',
      'На что ушло больше всего в сентябре?',
      'Сравни транспорт этим летом и прошлым',
      'Самые крупные покупки за месяц',
    ]);
    expect(screen.getByText(/В Claude уходят итоги и найденные операции, но не вся история целиком/)).toBeInTheDocument();
    // «Новый разговор» пока нечего сбрасывать
    expect(screen.queryByRole('button', { name: 'Новый разговор' })).not.toBeInTheDocument();
  });

  it('tapping an example asks it right away', () => {
    const { onSend } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Самые крупные покупки за месяц' }));
    expect(onSend).toHaveBeenCalledWith('Самые крупные покупки за месяц');
  });

  it('keeps the send button disabled until there is a question, and sends the trimmed text once', () => {
    const { onSend } = setup();
    const send = screen.getByRole('button', { name: 'Спросить' });
    expect(input()).toHaveAttribute('placeholder', 'Спросите о расходах');
    expect(send).toBeDisabled();

    fireEvent.change(input(), { target: { value: '   ' } });
    expect(send).toBeDisabled();
    fireEvent.change(input(), { target: { value: 'я' } });
    expect(send).toBeDisabled();

    fireEvent.change(input(), { target: { value: '  Сколько на кафе?  ' } });
    expect(send).toBeEnabled();
    fireEvent.submit(screen.getByRole('form', { name: 'Вопрос' }));
    expect(onSend).toHaveBeenCalledWith('Сколько на кафе?');
    expect(input()).toHaveValue('');
  });

  it('keeps the text when the question was not accepted', () => {
    const onSend = vi.fn(() => false);
    setup({ onSend });
    fireEvent.change(input(), { target: { value: 'Сколько на кафе?' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Вопрос' }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(input()).toHaveValue('Сколько на кафе?');
  });

  it('limits the question to 500 characters', () => {
    setup();
    expect(input()).toHaveAttribute('maxlength', '500');
  });
});

describe('AskScreen: a conversation', () => {
  it('lists turns in a log region that screen readers announce politely', () => {
    setup({ turns: [answerTurn()] });
    const log = screen.getByRole('log', { name: 'Разговор' });
    expect(log).toHaveAttribute('aria-live', 'polite');
    expect(within(log).getByText('Сравни транспорт этим летом и прошлым')).toBeInTheDocument();
    expect(within(log).getByRole('article', { name: 'Ответ' })).toBeInTheDocument();
    // Вводный текст и примеры остаются только пустому разговору
    expect(screen.queryByRole('region', { name: 'Примеры вопросов' })).not.toBeInTheDocument();
    expect(input()).toHaveAttribute('placeholder', 'Уточните или спросите ещё');
  });

  it('renders the answer: bold amounts, a real table with column headers, the basis', () => {
    setup({ turns: [answerTurn()] });
    const answer = screen.getByRole('article', { name: 'Ответ' });

    const bold = Array.from(answer.querySelectorAll('strong')).map((node) => node.textContent);
    expect(bold).toEqual(['€412', '€538']);
    expect(answer).toHaveTextContent('Этим летом на транспорт ушло €412, прошлым — €538.');

    const table = within(answer).getByRole('table');
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((header) => header.textContent)).toEqual(['Месяц', '2026', '2025']);
    expect(headers.every((header) => header.getAttribute('scope') === 'col')).toBe(true);
    expect(within(table).getAllByRole('row').map((row) => row.textContent)).toEqual(['Месяц20262025', 'Июнь€148€171', 'Июль€131€205']);

    expect(answer).toHaveTextContent('Посчитано: Транспорт, июнь – август 2025 и 2026');
    expect(answer).toHaveTextContent('Больше всего разница в июле.');
  });

  it('shows model text as text, never as markup', () => {
    const turn = answerTurn({
      answer: {
        blocks: [
          { type: 'text', text: '<img src=x onerror="alert(1)"> **<b>жирный</b>**' },
          { type: 'table', columns: ['<i>а</i>'], rows: [['<script>x()</script>']] },
        ],
        basis: '<u>основа</u>',
        history: null,
      },
    });
    setup({ turns: [turn] });
    const answer = screen.getByRole('article', { name: 'Ответ' });
    expect(answer.querySelector('img, script, i, u, b')).toBeNull();
    expect(answer).toHaveTextContent('<img src=x onerror="alert(1)">');
    expect(answer.querySelector('strong')).toHaveTextContent('<b>жирный</b>');
    expect(answer).toHaveTextContent('<script>x()</script>');
  });

  it('«Открыть в Истории» hands the filter over; without a filter there is no button', () => {
    const { onOpenHistory } = setup({ turns: [answerTurn()] });
    fireEvent.click(screen.getByRole('button', { name: 'Открыть в Истории' }));
    expect(onOpenHistory).toHaveBeenCalledWith({ category: 'Транспорт', account: null, type: 'expense', month: '2026-08' });
  });

  it('answer without a filter has the basis but no history button', () => {
    const turn = answerTurn();
    turn.answer = { ...turn.answer, history: null };
    setup({ turns: [turn] });
    expect(screen.getByText(/Посчитано:/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Открыть в Истории' })).not.toBeInTheDocument();
  });

  it('a question being answered: live steps, a read-only field and «Остановить»', () => {
    const steps = [
      { label: 'Транспорт, 1 июня – 31 августа 2026', done: true },
      { label: 'Транспорт, 1 июня – 31 августа 2025', done: false },
    ];
    setup({ turns: [workingTurn(steps)] });

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    const rows = within(status).getAllByText(/Транспорт, 1 июня/);
    expect(rows).toHaveLength(2);
    // Готовый шаг с галочкой и пометкой для читалки, текущий со спиннером
    expect(within(status).getByText('Готово:')).toBeInTheDocument();
    expect(status.querySelectorAll('.ask-spinner')).toHaveLength(1);

    expect(input()).toHaveAttribute('readonly');
    expect(input()).toHaveAttribute('placeholder', 'Claude отвечает…');
    expect(screen.queryByRole('button', { name: 'Спросить' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Остановить' })).toBeInTheDocument();
  });

  it('says what is happening before the first step and after the last one', () => {
    const { unmount } = render(<AskScreen turns={[workingTurn([])]} onSend={vi.fn()} onRetry={vi.fn()} onStop={vi.fn()} onReset={vi.fn()} onBack={vi.fn()} onOpenHistory={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Думаю над вопросом');
    unmount();

    render(<AskScreen turns={[workingTurn([{ label: 'Остатки по счетам', done: true }])]} onSend={vi.fn()} onRetry={vi.fn()} onStop={vi.fn()} onReset={vi.fn()} onBack={vi.fn()} onOpenHistory={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Формулирую ответ');
  });

  it('«Остановить» stops and puts the question back into the field', () => {
    const onStop = vi.fn(() => 'На что ушло больше всего в сентябре?');
    setup({ turns: [workingTurn()], onStop });
    fireEvent.click(screen.getByRole('button', { name: 'Остановить' }));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(input()).toHaveValue('На что ушло больше всего в сентябре?');
  });

  it('«Новый разговор» is disabled while Claude answers and clears the conversation otherwise', () => {
    const first = render(<AskScreen turns={[workingTurn()]} onSend={vi.fn()} onRetry={vi.fn()} onStop={vi.fn()} onReset={vi.fn()} onBack={vi.fn()} onOpenHistory={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Новый разговор' })).toBeDisabled();
    first.unmount();

    const { onReset } = setup({ turns: [answerTurn()] });
    const reset = screen.getByRole('button', { name: 'Новый разговор' });
    expect(reset).toBeEnabled();
    fireEvent.click(reset);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('an error turn: alert with the reason and «Повторить» that resends the same question', () => {
    const { onRetry } = setup({ turns: [errorTurn()] });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Не получилось ответить. Claude не ответил вовремя. Вопрос сохранен, его можно отправить еще раз.');
    expect(screen.getByText('На что ушло больше всего в сентябре?')).toBeInTheDocument();
    // Поле при этом свободно
    expect(input()).not.toHaveAttribute('readonly');

    fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }));
    expect(onRetry).toHaveBeenCalledWith(3);
  });

  it('does not repeat «Не получилось ответить.» when the server message already starts with it', () => {
    setup({ turns: [errorTurn({ error: 'Не получилось ответить. Попробуйте спросить иначе.' })] });
    expect(screen.getByRole('alert').textContent).toBe('Не получилось ответить. Попробуйте спросить иначе.Повторить');
  });

  it('only the last error can be retried', () => {
    setup({ turns: [errorTurn({ id: 3 }), answerTurn({ id: 4 })] });
    expect(screen.queryByRole('button', { name: 'Повторить' })).not.toBeInTheDocument();
  });

  it('the composer sits above the bottom navigation', () => {
    setup();
    const form = screen.getByRole('form', { name: 'Вопрос' });
    expect(form.style.position).toBe('fixed');
    expect(form.style.bottom).toContain('64px');
  });

  it('«Остановить» does not turn into a submit of the restored question', () => {
    // Кнопка «Остановить» и кнопка отправки занимают одно место: если бы React
    // переиспользовал один элемент, тот же клик ещё и отправил бы форму.
    const onSend = vi.fn(() => true);
    function Harness() {
      const [turns, setTurns] = useState([workingTurn()]);
      return (
        <AskScreen
          turns={turns}
          onSend={onSend}
          onRetry={vi.fn()}
          onStop={() => { setTurns([]); return 'На что ушло больше всего в сентябре?'; }}
          onReset={vi.fn()}
          onBack={vi.fn()}
          onOpenHistory={vi.fn()}
        />
      );
    }
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Остановить' }));

    expect(input()).toHaveValue('На что ушло больше всего в сентябре?');
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Спросить' })).toBeEnabled();
  });
});
