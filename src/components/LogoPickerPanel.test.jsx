import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LogoPickerPanel from './LogoPickerPanel';

const expense = { type: 'expense', companyName: 'Chop Chop', category: 'Красота' };
const response = merchants => ({ ok: true, json: async () => ({ merchants }) });

function renderPicker({ item = expense, apiFetch = vi.fn().mockResolvedValue(response([])), onMerchantSelect } = {}) {
  const onChange = vi.fn();
  const view = render(<LogoPickerPanel id="panel" item={item} apiFetch={apiFetch} onChange={onChange} onMerchantSelect={onMerchantSelect} />);
  const rename = companyName => view.rerender(<LogoPickerPanel id="panel" item={{ ...item, companyName }} apiFetch={apiFetch} onChange={onChange} onMerchantSelect={onMerchantSelect} />);
  return { ...view, apiFetch, onChange, rename };
}

beforeEach(() => vi.stubEnv('VITE_LOGO_DEV_PUBLISHABLE_KEY', 'pk_test_logo_picker'));
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe('logo picker panel', () => {
  it('searches the catalogue by the company name after a pause and selects the displayed domain', async () => {
    const apiFetch = vi.fn().mockResolvedValue(response([{ name: 'Chop Chop Barber Shop', domain: 'chopchop.com' }]));
    const { onChange, rename } = renderPicker({ apiFetch, item: { ...expense, companyName: 'Cho' } });
    rename('Chop Chop');
    expect(apiFetch).not.toHaveBeenCalled();

    expect(await screen.findByText('Похожие в каталоге')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Chop Chop Barber Shop.*chopchop\.com/ }));
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith('/api/merchants/search?q=Chop%20Chop', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(onChange).toHaveBeenCalledWith({ logoMode: 'domain', merchantDomain: 'chopchop.com' });
  });

  it('hands a chosen catalogue company to onMerchantSelect when the form wants its name too', async () => {
    const apiFetch = vi.fn().mockResolvedValue(response([{ name: 'Chop Chop Barber Shop', domain: 'chopchop.com' }]));
    const onMerchantSelect = vi.fn();
    const { onChange } = renderPicker({ apiFetch, onMerchantSelect });
    fireEvent.click(await screen.findByRole('button', { name: /Chop Chop Barber Shop.*chopchop\.com/ }));
    expect(onMerchantSelect).toHaveBeenCalledWith({ name: 'Chop Chop Barber Shop', domain: 'chopchop.com' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Сайт компании' })).toHaveValue('chopchop.com');
  });

  it('marks the catalogue company that is already the chosen website', async () => {
    const apiFetch = vi.fn().mockResolvedValue(response([{ name: 'Chop Chop Barber Shop', domain: 'chopchop.com' }, { name: 'Chop Shop', domain: 'chopshop.com' }]));
    renderPicker({ apiFetch, item: { ...expense, logoMode: 'domain', merchantDomain: 'chopchop.com' } });
    expect(screen.getByRole('textbox', { name: 'Сайт компании' })).toHaveValue('chopchop.com');
    expect(await screen.findByRole('button', { name: /Chop Chop Barber Shop.*Выбрано/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Chop Shop(?!.*Выбрано)/ })).toBeInTheDocument();
  });

  it('asks for at least two characters of the name before searching', () => {
    const { apiFetch } = renderPicker({ item: { ...expense, companyName: 'C' } });
    expect(screen.getByText('Введите хотя бы 2 символа')).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('validates a manual website and sends only its normalized hostname', () => {
    const { onChange } = renderPicker();
    const website = screen.getByRole('textbox', { name: 'Сайт компании' });
    expect(website).toHaveAttribute('placeholder', 'company.com');
    fireEvent.change(website, { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Укажите сайт компании');
    expect(website).toHaveAttribute('aria-invalid', 'true');
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(website, { target: { value: 'https://ChopChop.com/locations?city=limassol' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
    expect(onChange).toHaveBeenCalledWith({ logoMode: 'domain', merchantDomain: 'chopchop.com' });
  });

  it('aborts a superseded search and ignores its late result even if the transport resolves it', async () => {
    let finishOld;
    let finishNew;
    const apiFetch = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve; }));
    const { rename } = renderPicker({ apiFetch });
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    const oldSignal = apiFetch.mock.calls[0][1].signal;
    rename('New Barber');
    expect(oldSignal.aborted).toBe(true);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));

    await act(async () => { finishNew(response([{ name: 'New Barber', domain: 'newbarber.com' }])); });
    expect(screen.getByRole('button', { name: /New Barber.*newbarber\.com/ })).toBeInTheDocument();
    await act(async () => { finishOld(response([{ name: 'Old Barber', domain: 'oldbarber.com' }])); });
    expect(screen.queryByRole('button', { name: /Old Barber/ })).toBeNull();
    expect(screen.getByRole('button', { name: /New Barber.*newbarber\.com/ })).toBeInTheDocument();
  });

  it('keeps manual selection available when the catalogue fails', async () => {
    const apiFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const { onChange } = renderPicker({ apiFetch });
    expect(await screen.findByText('Каталог сейчас недоступен. Можно указать сайт вручную.')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Сайт компании' }), { target: { value: 'chopchop.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
    expect(onChange).toHaveBeenCalledWith({ logoMode: 'domain', merchantDomain: 'chopchop.com' });
  });
});
