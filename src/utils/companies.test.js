import { describe, expect, it, vi } from 'vitest';
import { companyChoice, companyKey, companyNameChoice, companyUses, getCompanySuggestions, saveCompanySelection } from './companies';

const company = { _id: '012345678901234567890123', __v: 2, name: 'Mr & Mrs Pet', logoMode: 'domain', merchantDomain: 'petshop.com' };
const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

describe('company registry selection', () => {
  it('suggests the saved company before historical choices without treating comments as names', () => {
    const history = [
      { type: 'expense', description: 'MR&MRS PET', logoMode: 'domain', merchantDomain: 'oldpet.com' },
      { type: 'expense', companyName: 'New Shop', description: 'Корм собаке', logoMode: 'category' },
      { type: 'expense', companyName: '', description: 'Not a company', logoMode: 'category' },
      { type: 'expense', description: 'Unchosen name', logoMode: 'auto' },
    ];
    expect(companyKey(' MR&MRS  PET ')).toBe(companyKey(company.name));
    expect(getCompanySuggestions([company], history)).toEqual([
      expect.objectContaining({ _id: company._id, merchantDomain: 'petshop.com', source: 'saved' }),
      expect.objectContaining({ name: 'New Shop', source: 'history' }),
    ]);
    expect(getCompanySuggestions([company], history, 'корм')).toEqual([]);
  });

  it('retains the latest explicit historical website despite newer automatic entries', () => {
    const rows = [
      { type: 'expense', description: 'Shop', date: '2026-09-01', logoMode: 'domain', merchantDomain: 'old.com' },
      { type: 'expense', description: 'Shop', date: '2026-09-05', logoMode: 'domain', merchantDomain: 'new.com' },
      { type: 'expense', description: 'Shop', date: '2026-09-12', logoMode: 'auto' },
      { type: 'expense', description: 'Shop', date: '2026-09-13', logoMode: 'domain', merchantDomain: 'localhost' },
    ];
    expect(getCompanySuggestions([], rows, 'shop')[0].merchantDomain).toBe('new.com');
    expect(getCompanySuggestions([], [...rows].reverse(), 'shop')[0].merchantDomain).toBe('new.com');
  });

  it('puts companies with the current category first, after an exact name match, without dropping others', () => {
    const saved = [
      { _id: 'a', name: 'Alpha', logoMode: 'auto', category: 'Услуги', usage: { Услуги: 2 }, lastUsed: '2026-09-02' },
      { _id: 'b', name: 'Beta', logoMode: 'auto', category: 'Кафе', usage: { Кафе: 2 }, lastUsed: '2026-09-02' },
      { _id: 'c', name: 'Gamma', logoMode: 'auto' },
    ];
    const history = [{ type: 'expense', companyName: 'Delta', logoMode: 'category', category: 'Кафе', date: '2026-09-01' }];
    expect(getCompanySuggestions(saved, history).map(c => c.name)).toEqual(['Alpha', 'Beta', 'Delta', 'Gamma']);
    expect(getCompanySuggestions(saved, history, '', 'Кафе').map(c => c.name)).toEqual(['Beta', 'Delta', 'Alpha', 'Gamma']);
    expect(getCompanySuggestions(saved, history, 'alpha', 'Кафе').map(c => c.name)).toEqual(['Alpha']);
    expect(getCompanySuggestions([{ ...saved[0], name: 'Beta Alpha' }, ...saved.slice(1)], [], 'beta', 'Услуги').map(c => c.name)).toEqual(['Beta', 'Beta Alpha']);
  });

  it('ranks by uses in the selected category, then total uses, then recency, then name', () => {
    const saved = [
      { _id: 'a', name: 'Alpha', logoMode: 'auto', usage: { Кафе: 1, Продукты: 4 }, lastUsed: '2026-09-10' },
      { _id: 'b', name: 'Beta', logoMode: 'auto', usage: { Кафе: 3 }, lastUsed: '2026-09-01' },
      { _id: 'c', name: 'Gamma', logoMode: 'auto', usage: { Продукты: 6 }, lastUsed: '2026-09-20' },
      { _id: 'd', name: 'Delta', logoMode: 'auto' },
    ];
    expect(getCompanySuggestions(saved, [], '', 'Кафе').map(c => c.name)).toEqual(['Beta', 'Alpha', 'Gamma', 'Delta']);
    expect(getCompanySuggestions(saved, []).map(c => c.name)).toEqual(['Gamma', 'Alpha', 'Beta', 'Delta']);
    expect(getCompanySuggestions(saved, [], '', 'Транспорт').map(c => c.name)).toEqual(['Gamma', 'Alpha', 'Beta', 'Delta']);
    const ties = [
      { _id: 'x', name: 'Zed', logoMode: 'auto', usage: { Кафе: 2 }, lastUsed: '2026-09-05' },
      { _id: 'y', name: 'Yak', logoMode: 'auto', usage: { Кафе: 2 }, lastUsed: '2026-09-05' },
      { _id: 'w', name: 'Wow', logoMode: 'auto', usage: { Кафе: 2 }, lastUsed: '2026-09-06' },
    ];
    expect(getCompanySuggestions(ties, [], '', 'Кафе').map(c => c.name)).toEqual(['Wow', 'Yak', 'Zed']);
    expect(getCompanySuggestions([...ties, { _id: 'v', name: 'Zed 2', logoMode: 'auto', usage: { Кафе: 9 } }], [], 'zed', 'Кафе').map(c => c.name)).toEqual(['Zed', 'Zed 2']);
  });

  it('counts raw local transactions per category and merges server history rows', () => {
    const rows = [
      { type: 'expense', companyName: 'Cafe One', logoMode: 'category', category: 'Кафе', date: '2026-09-01' },
      { type: 'expense', companyName: 'Cafe One', logoMode: 'category', category: 'Кафе', date: '2026-09-03' },
      { type: 'expense', companyName: 'Cafe One', logoMode: 'category', category: 'Продукты', date: '2026-09-02' },
      { type: 'expense', companyName: 'Shop', logoMode: 'category', category: 'Продукты', date: '2026-09-04' },
      { type: 'expense', companyName: 'Shop', logoMode: 'category', category: 'Продукты', date: '2026-09-05' },
      { type: 'expense', companyName: 'Shop', logoMode: 'category', category: 'Продукты', date: '2026-09-06', deletedAt: '2026-09-07' },
    ];
    const [cafe, shop] = getCompanySuggestions([], rows);
    expect(cafe).toMatchObject({ name: 'Cafe One', usage: { Кафе: 2, Продукты: 1 }, lastUsed: '2026-09-03' });
    expect(shop).toMatchObject({ name: 'Shop', usage: { Продукты: 2 }, lastUsed: '2026-09-05' });
    expect(getCompanySuggestions([], rows, '', 'Продукты').map(c => c.name)).toEqual(['Shop', 'Cafe One']);
    const server = [
      { type: 'expense', companyName: 'Late', logoMode: 'category', category: 'Кафе', usage: { Кафе: 4, Продукты: 1 }, lastUsed: '2026-09-09T10:00:00.000Z' },
      { type: 'expense', companyName: 'Early', logoMode: 'category', category: 'Продукты', usage: { Продукты: 5 }, lastUsed: '2026-09-01T10:00:00.000Z' },
    ];
    expect(getCompanySuggestions([], server, '', 'Кафе').map(c => c.name)).toEqual(['Late', 'Early']);
    expect(getCompanySuggestions([], server, '', 'Продукты').map(c => c.name)).toEqual(['Early', 'Late']);
  });

  it('carries the latest category of a historical company', () => {
    const rows = [
      { type: 'expense', companyName: 'Shop', date: '2026-09-01', logoMode: 'category', category: 'Старая' },
      { type: 'expense', companyName: 'Shop', date: '2026-09-05', logoMode: 'category', category: 'Новая' },
    ];
    expect(getCompanySuggestions([], rows)[0].category).toBe('Новая');
  });

  it('leaves legacy transactions and unchanged linked snapshots untouched', async () => {
    const request = vi.fn();
    for (const item of [
      { type: 'expense', description: 'Old shop', logoMode: 'domain', merchantDomain: 'old.com' },
      { type: 'expense', companyName: '', description: 'Comment' },
      { type: 'expense', companyId: company._id, companyName: 'Old company name', merchantDomain: 'old.com' },
      { type: 'income', companyName: 'Ignore' },
    ]) expect(await saveCompanySelection(item, { request })).toBe(item);
    expect(request).not.toHaveBeenCalled();
  });

  it('creates a company and returns a linked snapshot without changing the comment', async () => {
    const request = vi.fn().mockResolvedValue(reply(company, 201));
    const item = { type: 'expense', companyName: 'Mr & Mrs Pet', description: 'Корм собаке', logoMode: 'domain', merchantDomain: 'petshop.com' };
    expect(await saveCompanySelection(item, { request })).toMatchObject({ ...item, companyId: company._id });
    expect(JSON.parse(request.mock.calls[0][1].body)).not.toHaveProperty('description');
  });

  it('reuses a duplicate created by another tab instead of making another company', async () => {
    const request = vi.fn().mockResolvedValue(reply({ code: 'COMPANY_EXISTS', company }, 409));
    const result = await saveCompanySelection({ type: 'expense', companyName: 'mr & mrs pet', logoMode: 'auto' }, { request });
    expect(result).toMatchObject({ companyId: company._id, logoMode: 'domain', merchantDomain: 'petshop.com' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('updates an explicitly changed logo using the registry version while retaining an old snapshot name', async () => {
    const renamed = { ...company, name: 'Renamed Pet Shop' };
    const request = vi.fn().mockResolvedValueOnce(reply([renamed])).mockResolvedValueOnce(reply({ ...renamed, __v: 3, merchantDomain: 'correct.com' }));
    const result = await saveCompanySelection({ type: 'expense', companyId: company._id, companyName: company.name, logoMode: 'domain', merchantDomain: 'correct.com' }, { request, logoChanged: true });
    expect(JSON.parse(request.mock.calls[1][1].body)).toMatchObject({ __v: 2, name: 'Renamed Pet Shop', merchantDomain: 'correct.com' });
    expect(result.companyName).toBe(company.name);
    expect(result.merchantDomain).toBe('correct.com');
  });

  it('surfaces failed and stale registry saves so the transaction is not submitted', async () => {
    const item = { type: 'expense', companyName: 'Pet Shop', logoMode: 'auto' };
    await expect(saveCompanySelection(item, { request: vi.fn().mockResolvedValue(reply({ message: 'Каталог недоступен' }, 500)) })).rejects.toThrow('Каталог недоступен');
    const request = vi.fn().mockResolvedValueOnce(reply([company])).mockResolvedValueOnce(reply({ code: 'COMPANY_STALE', message: 'Компания уже изменена' }, 409));
    await expect(saveCompanySelection({ ...item, companyId: company._id }, { request, logoChanged: true })).rejects.toThrow('Компания уже изменена');
  });
});

describe('company choice for the form', () => {
  const saved = { _id: 'p1', name: 'Mr & Mrs Pet', logoMode: 'domain', merchantDomain: 'petshop.com', category: 'Питомцы', usage: { Питомцы: 4, Продукты: 1 } };

  it('turns a suggestion into form fields with its usual category', () => {
    expect(companyChoice(saved)).toEqual({ companyId: 'p1', companyName: 'Mr & Mrs Pet', logoMode: 'domain', merchantDomain: 'petshop.com', usualCategory: 'Питомцы' });
    expect(companyChoice({ name: 'Old shop', logoMode: 'category', source: 'history' })).toEqual({ companyId: '', companyName: 'Old shop', logoMode: 'category', merchantDomain: '', usualCategory: undefined });
    expect(companyChoice({ _id: 'p2', name: 'Bare' }).logoMode).toBe('auto');
  });

  it('matches a typed name to a saved company, then to history, otherwise treats it as new', () => {
    const history = [{ type: 'expense', companyName: 'Old shop', logoMode: 'domain', merchantDomain: 'old.com', category: 'Дом', date: '2026-09-01' }];
    expect(companyNameChoice('mr&mrs  pet', [saved], history)).toMatchObject({ companyId: 'p1', companyName: 'mr&mrs  pet', merchantDomain: 'petshop.com', usualCategory: 'Питомцы' });
    expect(companyNameChoice('OLD SHOP', [saved], history)).toEqual({ companyId: '', companyName: 'OLD SHOP', logoMode: 'domain', merchantDomain: 'old.com', usualCategory: 'Дом' });
    expect(companyNameChoice('Brand new', [saved], history)).toEqual({ companyId: '', companyName: 'Brand new', logoMode: 'auto', merchantDomain: '' });
    expect(companyNameChoice('  ', [saved], history)).toEqual({ companyId: '', companyName: '  ', logoMode: 'category', merchantDomain: '' });
  });

  it('counts the operations of a company over all categories', () => {
    expect(companyUses(saved)).toBe(5);
    expect(companyUses({ name: 'No data' })).toBe(0);
    expect(companyUses(undefined)).toBe(0);
  });
});
