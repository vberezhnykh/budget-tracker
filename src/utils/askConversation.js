// Разговор «Вопросы к данным» на стороне клиента: как ответ превращается в текст
// для следующего вопроса, как выделяется **жирное** и как проверяется ответ
// сервера. Сам разговор нигде не хранится: сервер получает его с каждым
// вопросом, а клиент держит только в памяти приложения.

// Сервер принимает не больше 20 реплик (10 пар) и ответ ассистента до 4000
// знаков. Пары берутся с конца: новое важнее старого.
const MAX_HISTORY_PAIRS = 9;
const MAX_ASSISTANT_TEXT = 3900;

// Ответ - блоки текста и таблицы. Для следующего вопроса он уходит обычным
// текстом: абзацы как есть, таблица строками «колонка | колонка».
export function blocksToText(blocks) {
  const parts = (blocks || []).map((block) => {
    if (block.type === 'table') {
      return [block.columns, ...block.rows].map((row) => row.join(' | ')).join('\n');
    }
    return block.text;
  });
  const text = parts.filter(Boolean).join('\n\n').trim();
  return text.length > MAX_ASSISTANT_TEXT ? `${text.slice(0, MAX_ASSISTANT_TEXT)}…` : text;
}

// Сообщения для сервера: прошлые пары «вопрос - ответ» и новый вопрос. Вопросы
// без ответа (ошибка, остановка) не берутся: порядок реплик должен чередоваться.
export function buildAskMessages(turns, question) {
  const pairs = turns
    .filter((turn) => turn.status === 'done' && turn.answer)
    .map((turn) => ({ question: turn.question, answer: blocksToText(turn.answer.blocks) }))
    .filter((pair) => pair.answer)
    .slice(-MAX_HISTORY_PAIRS);
  return [
    ...pairs.flatMap((pair) => [{ role: 'user', text: pair.question }, { role: 'assistant', text: pair.answer }]),
    { role: 'user', text: question },
  ];
}

// «Ушло **€412** за лето» -> [{ text: 'Ушло ', bold: false }, { text: '€412', bold: true }, ...].
// Только пары ** и только как текст: никакой разметки и HTML, поэтому
// вставить через ответ нечего. Одинокие ** остаются в тексте как есть.
export function parseBold(text) {
  const parts = [];
  const pattern = /\*\*([^*]+?)\*\*/g;
  let last = 0;
  for (const match of String(text).matchAll(pattern)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index), bold: false });
    parts.push({ text: match[1], bold: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), bold: false });
  return parts;
}

const isStrings = (list) => Array.isArray(list) && list.every((item) => typeof item === 'string');

// Ответ сервера в виде, который умеет показать экран, или null. Сервер уже
// проверил и обрезал ответ; здесь только защита от неожиданной формы.
export function normalizeAnswer(event) {
  if (!event || !Array.isArray(event.blocks)) return null;
  const blocks = event.blocks.flatMap((block) => {
    if (block?.type === 'text' && typeof block.text === 'string' && block.text) return [{ type: 'text', text: block.text }];
    if (block?.type === 'table' && isStrings(block.columns) && Array.isArray(block.rows) && block.rows.every(isStrings)) {
      return [{ type: 'table', columns: block.columns, rows: block.rows }];
    }
    return [];
  });
  if (blocks.length === 0) return null;
  const history = event.history && typeof event.history === 'object'
    ? {
      category: typeof event.history.category === 'string' ? event.history.category : null,
      account: typeof event.history.account === 'string' ? event.history.account : null,
      type: event.history.type === 'expense' || event.history.type === 'income' ? event.history.type : null,
      month: typeof event.history.month === 'string' && /^\d{4}-\d{2}$/.test(event.history.month) ? event.history.month : null,
    }
    : null;
  return {
    blocks,
    basis: typeof event.basis === 'string' ? event.basis : '',
    history: history && Object.values(history).some(Boolean) ? history : null,
  };
}
