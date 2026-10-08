// Русское число: «1 категория, 2 категории, 5 категорий». forms - три формы
// для 1, 2-4 и 5+; 11-14 - исключение, у них всегда третья («11 категорий»,
// а не «11 категория»).
export const pluralForm = (count, [one, few, many]) => {
  const lastTwo = Math.abs(count) % 100;
  const last = Math.abs(count) % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
};
