import { describe, it, expect } from 'vitest';
import { pluralForm } from './plural';

describe('pluralForm', () => {
  const forms = ['категория', 'категории', 'категорий'];

  it.each([
    [1, 'категория'], [2, 'категории'], [4, 'категории'], [5, 'категорий'], [0, 'категорий'],
    [11, 'категорий'], [12, 'категорий'], [14, 'категорий'], [21, 'категория'], [22, 'категории'], [25, 'категорий'],
    [101, 'категория'], [111, 'категорий'],
  ])('%i -> %s', (count, word) => {
    expect(pluralForm(count, forms)).toBe(word);
  });
});
