import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const ok = body => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });

function mockApi(features) {
  const fetchMock = vi.fn(url => {
    if (url === '/api/accounts') return ok([{ _id: 'card', name: 'Моя карта', type: 'card', icon: '💳' }]);
    if (url === '/api/settings') return ok({ monthlyLimit: 7000, ...(features === undefined ? {} : { features }) });
    if (url === '/api/banking') return ok({ configured: true, connections: [], pendingReviewCount: 0 });
    if (url === '/api/banking/review') return ok({ items: [], total: 0 });
    return ok([]);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
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
    fireEvent.click(screen.getByTitle('Настройки'));
    expect(screen.queryByRole('button', { name: /^Банки/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Банки', exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Добавить счёт' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/banking'))).toBe(false);
    expect(window.location.search).toBe('');
  });

  it('can open the retained module when the server explicitly enables it', async () => {
    const fetchMock = mockApi({ banking: true });
    render(<App />);
    await waitFor(() => expect(screen.getByText('Моя карта')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('Настройки'));
    fireEvent.click(screen.getByRole('button', { name: /^Банки/ }));
    expect(await screen.findByRole('dialog', { name: 'Банки', exact: true })).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/banking/review', undefined));
    expect(screen.getByRole('button', { name: 'Подключить Bank of Cyprus' })).toBeInTheDocument();
  });
});
