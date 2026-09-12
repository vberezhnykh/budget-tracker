import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TransactionLogoPicker from './TransactionLogoPicker';

const expense = { type: 'expense', description: 'Chop Chop', category: 'Красота' };
const response = merchants => ({ ok: true, json: async () => ({ merchants }) });

function ControlledPicker({ initialItem, apiFetch, onChange }) {
  const [item, setItem] = useState(initialItem);
  return <TransactionLogoPicker item={item} apiFetch={apiFetch} onChange={choice => {
    onChange(choice);
    setItem(previous => ({ ...previous, ...choice }));
  }} />;
}

function renderPicker({ item = expense, apiFetch = vi.fn().mockResolvedValue(response([])) } = {}) {
  const onChange = vi.fn();
  return { ...render(<ControlledPicker initialItem={item} apiFetch={apiFetch} onChange={onChange} />), apiFetch, onChange };
}

beforeEach(() => vi.stubEnv('VITE_LOGO_DEV_PUBLISHABLE_KEY', 'pk_test_logo_picker'));
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe('transaction logo picker', () => {
  it('debounces catalogue searches and selects the displayed company domain', async () => {
    const apiFetch = vi.fn().mockResolvedValue(response([{ name: 'Chop Chop Barber Shop', domain: 'chopchop.com' }]));
    const { onChange } = renderPicker({ apiFetch });
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать иконку' }));
    const search = screen.getByRole('searchbox', { name: 'Найти компанию' });
    fireEvent.change(search, { target: { value: 'Cho' } });
    fireEvent.change(search, { target: { value: 'Chop Chop' } });
    expect(apiFetch).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: /Chop Chop Barber Shop.*chopchop\.com/ }));
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith('/api/merchants/search?q=Chop%20Chop', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(onChange).toHaveBeenCalledWith({ logoMode: 'domain', merchantDomain: 'chopchop.com' });
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('lets category and automatic modes clear a previously selected domain', () => {
    const { onChange, container } = renderPicker({ item: { ...expense, logoMode: 'domain', merchantDomain: 'chopchop.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать иконку' }));
    fireEvent.click(screen.getByRole('button', { name: 'Иконка категории', exact: true }));
    expect(onChange).toHaveBeenLastCalledWith({ logoMode: 'category', merchantDomain: '' });
    expect(container.querySelector('img')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Выбрать иконку' }));
    fireEvent.click(screen.getByRole('button', { name: 'Автоподбор', exact: true }));
    expect(onChange).toHaveBeenLastCalledWith({ logoMode: 'auto', merchantDomain: '' });
  });

  it('validates a manual website and sends only its normalized hostname', () => {
    const { onChange } = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать иконку' }));
    const website = screen.getByRole('textbox', { name: 'Или укажите сайт компании' });
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
    renderPicker({ apiFetch });
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать иконку' }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    const oldSignal = apiFetch.mock.calls[0][1].signal;
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'New Barber' } });
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
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать иконку' }));
    expect(await screen.findByText('Каталог сейчас недоступен. Можно указать сайт вручную.')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Или укажите сайт компании' }), { target: { value: 'chopchop.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
    expect(onChange).toHaveBeenCalledWith({ logoMode: 'domain', merchantDomain: 'chopchop.com' });
  });
});
