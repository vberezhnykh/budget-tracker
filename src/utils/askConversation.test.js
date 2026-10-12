import { describe, expect, it } from 'vitest';
import { blocksToText, buildAskMessages, normalizeAnswer, parseBold } from './askConversation';

const done = (question, text) => ({ status: 'done', question, answer: { blocks: [{ type: 'text', text }], basis: '', history: null } });

describe('blocksToText', () => {
  it('joins paragraphs and writes a table as rows', () => {
    expect(blocksToText([
      { type: 'text', text: 'Летом ушло **€412**.' },
      { type: 'table', columns: ['Месяц', '2026'], rows: [['Июнь', '€148'], ['Июль', '€131']] },
      { type: 'text', text: 'Разница в июле.' },
    ])).toBe('Летом ушло **€412**.\n\nМесяц | 2026\nИюнь | €148\nИюль | €131\n\nРазница в июле.');
  });

  it('cuts a long answer to fit the server limit', () => {
    const text = blocksToText([{ type: 'text', text: 'я'.repeat(5000) }]);
    expect(text.length).toBeLessThanOrEqual(3901);
    expect(text.endsWith('…')).toBe(true);
  });

  it('is empty without blocks', () => {
    expect(blocksToText([])).toBe('');
    expect(blocksToText(undefined)).toBe('');
  });
});

describe('buildAskMessages', () => {
  it('sends finished pairs and the new question, alternating', () => {
    expect(buildAskMessages([done('Первый?', 'Первый ответ'), done('Второй?', 'Второй ответ')], 'Третий?')).toEqual([
      { role: 'user', text: 'Первый?' },
      { role: 'assistant', text: 'Первый ответ' },
      { role: 'user', text: 'Второй?' },
      { role: 'assistant', text: 'Второй ответ' },
      { role: 'user', text: 'Третий?' },
    ]);
  });

  it('leaves out questions that failed or are still being answered', () => {
    const turns = [
      done('Ответили', 'Да'),
      { status: 'error', question: 'Упало', answer: null },
      { status: 'working', question: 'Идёт', answer: null },
    ];
    expect(buildAskMessages(turns, 'Новый?').map((message) => message.text)).toEqual(['Ответили', 'Да', 'Новый?']);
  });

  it('keeps at most the last 9 pairs so the request stays within 20 messages', () => {
    const turns = Array.from({ length: 14 }, (_, index) => done(`Вопрос ${index}`, `Ответ ${index}`));
    const messages = buildAskMessages(turns, 'Последний?');
    expect(messages).toHaveLength(19);
    expect(messages[0].text).toBe('Вопрос 5');
    expect(messages.at(-1)).toEqual({ role: 'user', text: 'Последний?' });
  });

  it('just the question for a new conversation', () => {
    expect(buildAskMessages([], 'Сколько?')).toEqual([{ role: 'user', text: 'Сколько?' }]);
  });
});

describe('parseBold', () => {
  it('splits text on ** pairs', () => {
    expect(parseBold('Ушло **€412**, прошлым — **€538**.')).toEqual([
      { text: 'Ушло ', bold: false },
      { text: '€412', bold: true },
      { text: ', прошлым — ', bold: false },
      { text: '€538', bold: true },
      { text: '.', bold: false },
    ]);
  });

  it('leaves a lone or unbalanced ** as plain text', () => {
    expect(parseBold('a ** b')).toEqual([{ text: 'a ** b', bold: false }]);
    expect(parseBold('**открыто')).toEqual([{ text: '**открыто', bold: false }]);
    expect(parseBold('****')).toEqual([{ text: '****', bold: false }]);
  });

  it('treats markup as plain text', () => {
    expect(parseBold('<b>x</b> **<img src=x onerror=alert(1)>**')).toEqual([
      { text: '<b>x</b> ', bold: false },
      { text: '<img src=x onerror=alert(1)>', bold: true },
    ]);
  });

  it('handles empty text', () => {
    expect(parseBold('')).toEqual([]);
  });
});

describe('normalizeAnswer', () => {
  it('keeps a well-formed answer', () => {
    const event = {
      type: 'answer',
      blocks: [{ type: 'text', text: 'Да' }, { type: 'table', columns: ['a'], rows: [['1']] }],
      basis: 'Кафе, сентябрь 2026',
      history: { category: 'Кафе', account: null, type: 'expense', month: '2026-09' },
    };
    expect(normalizeAnswer(event)).toEqual({ blocks: event.blocks, basis: event.basis, history: event.history });
  });

  it('drops malformed blocks and the answer if nothing is left', () => {
    expect(normalizeAnswer({ blocks: [{ type: 'text', text: 'ok' }, { type: 'text', text: 5 }, { type: 'table', columns: 'a', rows: [] }, null] }).blocks).toEqual([{ type: 'text', text: 'ok' }]);
    expect(normalizeAnswer({ blocks: [{ type: 'image' }] })).toBeNull();
    expect(normalizeAnswer({ blocks: 'text' })).toBeNull();
    expect(normalizeAnswer(null)).toBeNull();
  });

  it('empty or invalid history becomes null', () => {
    const base = { blocks: [{ type: 'text', text: 'ok' }] };
    expect(normalizeAnswer({ ...base, history: { category: null, account: null, type: null, month: null } }).history).toBeNull();
    expect(normalizeAnswer({ ...base, history: 'x' }).history).toBeNull();
    expect(normalizeAnswer({ ...base, history: { type: 'transfer', month: '2026-9' } }).history).toBeNull();
    expect(normalizeAnswer({ ...base }).basis).toBe('');
  });
});
