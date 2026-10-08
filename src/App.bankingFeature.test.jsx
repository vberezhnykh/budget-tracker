import { readApi } from '../server/test/readApi.mjs';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const ok = body => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });

function mockApi(features) {
  const fetchMock = vi.fn(url => {
    const data = readApi(url);
    if (data !== undefined) return ok(data);
    if (url === '/api/accounts') return ok([{ _id: 'card', name: 'Моя карта', type: 'card', icon: '💳' }]);
    if (url === '/api/settings') return ok({ monthlyLimit: 7000, ...(features === undefined ? {} : { features }) });
    if (url === '/api/banking') return ok({ configured: true, connections: [], pendingReviewCount: 0 });
    if (url === '/api/banking/review') return ok({ items: [], total: 0 });
    if (url === '/api/trash') return ok([]);
    return ok([]);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// Строка «Банки» (если модуль включён) лежит в меню «Ещё».
function openMore() {
  fireEvent.click(screen.getByRole('button', { name: 'Ещё' }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('optional banking module', () => {
  it.each([undefined, { banking: false }, { banking: 'true' }])('hides banks and makes no bank requests without explicit enablement: %j', async features => {
    const fetchMock = mockApi(features);
    window.history.replaceState({}, '', '/?banking=connected');
    render(<App />);
    await waitFor(() => expect(screen.getByText('Моя карта')).toBeInTheDocument());
    openMore();
    expect(screen.queryByRole('button', { name: /^Банки/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Банки', exact: true })).not.toBeInTheDocument();
    // Меню на месте, а строки «Банки» в нём нет.
    expect(screen.getByRole('button', { name: /^Счета/ })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/banking'))).toBe(false);
    expect(window.location.search).toBe('');
  });

  it('can open the retained module when the server explicitly enables it', async () => {
    const fetchMock = mockApi({ banking: true });
    render(<App />);
    await waitFor(() => expect(screen.getByText('Моя карта')).toBeInTheDocument());
    openMore();
    fireEvent.click(screen.getByRole('button', { name: /^Банки/ }));
    expect(await screen.findByRole('dialog', { name: 'Банки', exact: true })).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/banking/review', undefined));
    expect(screen.getByRole('button', { name: 'Подключить Bank of Cyprus' })).toBeInTheDocument();
  });

  it('shows the pending proposals count on the «Банки» row while «Ещё» is open', async () => {
    const fetchMock = mockApi({ banking: true });
    const base = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((url, options) => (
      url === '/api/banking' ? ok({ configured: true, connections: [], pendingReviewCount: 3 }) : base(url, options)
    ));
    render(<App />);
    await waitFor(() => expect(screen.getByText('Моя карта')).toBeInTheDocument());
    // Пока меню не открывали, банки не читаются.
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/banking'))).toBe(false);

    openMore();

    await waitFor(() => expect(screen.getByRole('button', { name: /^Банки/ })).toHaveTextContent('предложений: 3'));
  });
});
