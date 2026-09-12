export const ACCOUNT_ICON_OPTIONS = [
  { id: 'credit-card', label: 'Карта' },
  { id: 'banknote', label: 'Наличные' },
  { id: 'wallet', label: 'Кошелёк' },
  { id: 'landmark', label: 'Банк' },
  { id: 'piggy-bank', label: 'Копилка' },
  { id: 'vault', label: 'Сейф' },
  { id: 'coins', label: 'Монеты' },
  { id: 'briefcase-business', label: 'Работа' },
  { id: 'house', label: 'Дом' },
  { id: 'lock-keyhole', label: 'Замок' },
];

const SUPPORTED_ICONS = new Set(ACCOUNT_ICON_OPTIONS.map(option => option.id));
const LEGACY_ICONS = new Map([
  ['💳', 'credit-card'],
  ['💵', 'banknote'], ['💶', 'banknote'], ['💷', 'banknote'], ['💴', 'banknote'],
  ['👛', 'wallet'], ['👝', 'wallet'], ['🎒', 'wallet'],
  ['🏦', 'landmark'], ['🏛', 'landmark'],
  ['💰', 'piggy-bank'], ['🐷', 'piggy-bank'], ['🐖', 'piggy-bank'],
  ['🗄', 'vault'], ['🪙', 'coins'], ['💼', 'briefcase-business'],
  ['🏠', 'house'], ['🏡', 'house'],
  ['🔒', 'lock-keyhole'], ['🔐', 'lock-keyhole'], ['🔑', 'lock-keyhole'],
]);

// Existing accounts keep their saved values. Resolve legacy emoji at display
// time, then save a semantic ID only when the user edits or creates an account.
export function resolveAccountIcon(icon, type = 'card') {
  const value = typeof icon === 'string' ? icon.trim().replace(/\uFE0F/g, '') : '';
  if (SUPPORTED_ICONS.has(value)) return value;
  return LEGACY_ICONS.get(value) || (type === 'cash' ? 'banknote' : 'credit-card');
}
