import { describe, expect, it, vi } from 'vitest';
import { companyKey, getCompanySuggestions, saveCompanySelection } from './companies';

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
