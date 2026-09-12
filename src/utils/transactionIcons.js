const normalize = (value) => typeof value === 'string'
  ? value.normalize('NFKC').toLowerCase().replace(/ё/g, 'е')
    .replace(/['’‘`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  : '';

// Specific services precede their parent brand. Match whole words so names
// such as «Zaragoza» and «Bolton» never get an unrelated merchant logo.
const MERCHANTS = [
  ['googleone', ['google one', 'googleone']],
  ['openai', ['chatgpt', 'chat gpt', 'openai', 'open ai']],
  ['wolt', ['wolt', 'волт']],
  ['zara', ['zara', 'зара']],
  ['mcdonalds', ['mcdonalds', 'mcdonald', 'mc donalds', 'макдоналдс', 'макдональдс']],
  ['google', ['google', 'гугл']],
  ['lidl', ['lidl', 'лидл']],
  ['ikea', ['ikea', 'икеа']],
  ['netflix', ['netflix', 'нетфликс']],
  ['spotify', ['spotify', 'спотифай']],
];

const CATEGORY_ALIASES = [
  ['groceries', ['Продукты', 'Еда', 'Супермаркеты', 'Groceries', 'Food']],
  ['dining', ['Кафе и доставка', 'Еда вне дома', 'Кафе', 'Рестораны', 'Кафе и рестораны', 'Доставка еды', 'Dining', 'Restaurants']],
  ['taxi', ['Такси', 'Taxi']],
  ['car', ['Авто', 'Автомобиль', 'Машина', 'Бензин', 'Топливо', 'Car']],
  ['transport', ['Транспорт', 'Общественный транспорт', 'Transport']],
  ['entertainment', ['Развлечения', 'Досуг', 'Entertainment']],
  ['clothing', ['Одежда и обувь', 'Одежда', 'Обувь', 'Clothing']],
  ['shopping', ['Шопинг', 'Шоппинг', 'Покупки', 'Shopping']],
  ['beauty', ['Красота', 'Уход за собой', 'Красота и уход', 'Beauty']],
  ['health', ['Здоровье', 'Медицина', 'Аптеки', 'Аптека', 'Health']],
  ['home', ['Жилье', 'Дом', 'Аренда', 'Квартира', 'Товары для дома', 'Home', 'Rent']],
  ['pets', ['Питомцы', 'Животные', 'Pets']],
  ['services', ['Услуги', 'Services']],
  ['travel', ['Отпуск', 'Путешествия', 'Поездки', 'Travel']],
  ['subscriptions', ['Подписки', 'Сервисы', 'Subscriptions']],
  ['education', ['Образование', 'Обучение', 'Книги', 'Education']],
  ['sports', ['Спорт', 'Фитнес', 'Sports']],
  ['gifts', ['Подарки', 'Благотворительность', 'Gifts']],
  ['bills', ['Коммунальные услуги', 'Коммуналка', 'Связь', 'Интернет', 'Bills']],
];

const CATEGORIES = new Map(CATEGORY_ALIASES.flatMap(([id, aliases]) =>
  aliases.map(alias => [normalize(alias), id])));

export function resolveTransactionIcon(item = {}) {
  // A branded description must not turn a transfer or a refund into an expense.
  if (['initial', 'transfer', 'income', 'split_group'].includes(item.type)) {
    return { kind: 'type', id: item.type };
  }
  if (item.type !== 'expense') return { kind: 'category', id: 'other' };

  // Resolve exactly the name visible in the row, not a hidden, stale title.
  const name = ` ${normalize(item.description || item.title)} `;
  const merchant = MERCHANTS.find(([, aliases]) =>
    aliases.some(alias => name.includes(` ${alias} `)));
  if (merchant) return { kind: 'merchant', id: merchant[0] };

  return { kind: 'category', id: CATEGORIES.get(normalize(item.category)) || 'other' };
}

// Always available while the remote logo loads, or when lookup is disabled.
export function resolveTransactionFallbackIcon(item = {}) {
  if (['initial', 'transfer', 'income', 'split_group'].includes(item.type)) {
    return { kind: 'type', id: item.type };
  }
  return { kind: 'category', id: CATEGORIES.get(normalize(item.category)) || 'other' };
}

// Retain the local merchant aliases for clean, consistent searches, while
// allowing new brands without adding an entry to the bundled logo catalogue.
export function getTransactionBrandName(item = {}) {
  if (item.type !== 'expense') return null;
  const name = normalize(item.description || item.title);
  if (!name || name.length > 120 || !/\p{L}/u.test(name)) return null;
  if (CATEGORIES.has(name) || name === normalize(item.category)
    || ['другое', 'без категории', 'расход', 'покупка', 'оплата', 'other', 'expense'].includes(name)) return null;

  const icon = resolveTransactionIcon(item);
  if (icon.kind === 'merchant') return icon.id === 'googleone' ? 'google one' : icon.id;
  return name;
}
