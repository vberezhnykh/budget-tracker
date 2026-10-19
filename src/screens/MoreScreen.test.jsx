import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MoreScreen from './MoreScreen';

const renderMenu = (props = {}) => render(
    <MoreScreen
        monthlyLimit={1500}
        accountsCount={3}
        categoriesCount={12}
        trashCount={4}
        lastSyncLabel="8 окт., 09:30"
        isRefreshing={false}
        isExporting={false}
        onOpenLimit={() => { }}
        onOpenAccounts={() => { }}
        onOpenCategories={() => { }}
        onOpenTrash={() => { }}
        onRefresh={() => { }}
        onExport={() => { }}
        onLogout={() => { }}
        {...props}
    />
);

describe('MoreScreen', () => {
    it('titles the tab «Ещё» without a back button', () => {
        renderMenu();

        expect(screen.getByRole('heading', { level: 1, name: 'Ещё' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /назад/i })).not.toBeInTheDocument();
    });

    it('groups rows under section captions', () => {
        renderMenu();

        for (const name of ['Бюджет', 'Учёт', 'Данные']) {
            expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
        }
    });

    it('opens each screen from its row', () => {
        const handlers = {
            onOpenLimit: vi.fn(),
            onOpenAccounts: vi.fn(),
            onOpenCategories: vi.fn(),
            onOpenTrash: vi.fn(),
        };
        renderMenu(handlers);

        fireEvent.click(screen.getByRole('button', { name: /Лимит трат в месяц/ }));
        fireEvent.click(screen.getByRole('button', { name: /Счета/ }));
        fireEvent.click(screen.getByRole('button', { name: /Категории/ }));
        fireEvent.click(screen.getByRole('button', { name: /Корзина/ }));

        for (const handler of Object.values(handlers)) expect(handler).toHaveBeenCalledTimes(1);
    });

    it('shows the limit in whole euros and the counts', () => {
        renderMenu();

        expect(screen.getByRole('button', { name: /Лимит трат в месяц/ })).toHaveTextContent('€1.500');
        expect(screen.getByRole('button', { name: /Счета/ })).toHaveTextContent('3');
        expect(screen.getByRole('button', { name: /Категории/ })).toHaveTextContent('12');
        expect(screen.getByRole('button', { name: /Корзина/ })).toHaveTextContent('4');
        expect(screen.getByText('Удалённые операции можно восстановить')).toBeInTheDocument();
    });

    it('hides the trash count while it is unknown', () => {
        renderMenu({ trashCount: null });

        const row = screen.getByRole('button', { name: /Корзина/ });
        expect(row.textContent).toBe('КорзинаУдалённые операции можно восстановить');
    });

    it('still shows a zero trash count', () => {
        renderMenu({ trashCount: 0 });
        expect(screen.getByRole('button', { name: /Корзина/ })).toHaveTextContent('0');
    });

    it('says the limit is not set when there is none', () => {
        renderMenu({ monthlyLimit: 0 });
        expect(screen.getByRole('button', { name: /Лимит трат в месяц/ })).toHaveTextContent('Не задан');
    });

    describe('«Старые описания» row', () => {
        const NOW = new Date('2026-10-15T12:00:00');
        const undo = (overrides = {}) => ({ runId: 'r1', undoUntil: '2026-11-14T12:00:00.000Z', stats: {}, ...overrides });
        const rowOf = () => screen.getByRole('button', { name: /Старые описания/ });

        it('is absent without the feature handler, whatever the summary says', () => {
            renderMenu({ cleanupSummary: { legacyCount: 40, run: null } });
            expect(screen.queryByText('Старые описания')).not.toBeInTheDocument();
        });

        it('is absent while the summary is unknown or has nothing to show', () => {
            const { unmount } = renderMenu({ onOpenCleanup: () => { }, cleanupSummary: null });
            expect(screen.queryByText('Старые описания')).not.toBeInTheDocument();
            unmount();

            renderMenu({ onOpenCleanup: () => { }, cleanupSummary: { legacyCount: 0, run: { status: 'reverted' } } });
            expect(screen.queryByText('Старые описания')).not.toBeInTheDocument();
        });

        it.each([
            [1, '1 операция без компании'],
            [3, '3 операции без компании'],
            [12, '12 операций без компании'],
            [21, '21 операция без компании'],
        ])('counts %i legacy operations in Russian', (legacyCount, subtitle) => {
            renderMenu({ onOpenCleanup: () => { }, cleanupSummary: { legacyCount, run: null } });
            expect(rowOf()).toHaveTextContent(subtitle);
        });

        it('shows the legacy count after a failed or reverted run', () => {
            renderMenu({ onOpenCleanup: () => { }, cleanupSummary: { legacyCount: 5, run: { status: 'failed' } } });
            expect(rowOf()).toHaveTextContent('5 операций без компании');
        });

        it('says Claude is working while the batch is submitted', () => {
            renderMenu({ onOpenCleanup: () => { }, cleanupSummary: { legacyCount: 40, run: { status: 'submitted' } } });
            expect(rowOf()).toHaveTextContent('Claude разбирает описания');
        });

        it('says the list is ready for review', () => {
            renderMenu({ onOpenCleanup: () => { }, cleanupSummary: { legacyCount: 40, run: { status: 'ready' } } });
            expect(rowOf()).toHaveTextContent('Готово к просмотру');
        });

        it('offers the undo date once applied, even with nothing left to clean', () => {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(NOW);
            try {
                renderMenu({ onOpenCleanup: () => { }, cleanupSummary: { legacyCount: 0, run: { status: 'applied' }, undo: undo() } });
                expect(rowOf()).toHaveTextContent('Можно отменить до 14 ноября');
            } finally {
                vi.useRealTimers();
            }
        });

        it('falls back to the count once the undo window is over', () => {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(NOW);
            try {
                renderMenu({ onOpenCleanup: () => { }, cleanupSummary: { legacyCount: 2, run: { status: 'applied' }, undo: null } });
                expect(rowOf()).toHaveTextContent('2 операции без компании');
            } finally {
                vi.useRealTimers();
            }
        });

        it('puts a run waiting for review before the undo date', () => {
            renderMenu({ onOpenCleanup: () => { }, cleanupSummary: { legacyCount: 2, run: { status: 'ready' }, undo: undo() } });
            expect(rowOf()).toHaveTextContent('Готово к просмотру');
        });

        it('opens the cleanup screen', () => {
            const onOpenCleanup = vi.fn();
            renderMenu({ onOpenCleanup, cleanupSummary: { legacyCount: 4, run: null } });
            fireEvent.click(rowOf());
            expect(onOpenCleanup).toHaveBeenCalledTimes(1);
        });
    });

    it('does not offer a banks row', () => {
        renderMenu();
        expect(screen.queryByText(/Банк/)).not.toBeInTheDocument();
    });

    it('shows the last sync time and refreshes only through its own button', () => {
        const onRefresh = vi.fn();
        renderMenu({ onRefresh });

        expect(screen.getByText('Синхронизировано')).toBeInTheDocument();
        expect(screen.getByText('8 окт., 09:30')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Синхронизировано/ })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
        expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('says so when nothing has been synced yet', () => {
        renderMenu({ lastSyncLabel: '' });
        expect(screen.getByText('Ещё не синхронизировано')).toBeInTheDocument();
    });

    it('disables refresh and shows progress while refreshing', () => {
        renderMenu({ isRefreshing: true });

        const button = screen.getByRole('button', { name: 'Обновление…' });
        expect(button).toBeDisabled();
        expect(screen.queryByRole('button', { name: 'Обновить' })).not.toBeInTheDocument();
    });

    it('exports from its row', () => {
        const onExport = vi.fn();
        renderMenu({ onExport });

        fireEvent.click(screen.getByRole('button', { name: 'Выгрузить в CSV' }));
        expect(onExport).toHaveBeenCalledTimes(1);
    });

    it('disables export and shows progress while exporting', () => {
        const onExport = vi.fn();
        renderMenu({ isExporting: true, onExport });

        const row = screen.getByRole('button', { name: 'Экспорт…' });
        expect(row).toBeDisabled();
        fireEvent.click(row);
        expect(onExport).not.toHaveBeenCalled();
    });

    it('logs out', () => {
        const onLogout = vi.fn();
        renderMenu({ onLogout });

        fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
        expect(onLogout).toHaveBeenCalledTimes(1);
    });

    it('keeps the sync section within its own group', () => {
        renderMenu();
        const data = screen.getByRole('region', { name: 'Данные' });

        expect(within(data).getByText('Синхронизировано')).toBeInTheDocument();
        expect(within(data).getByRole('button', { name: 'Выгрузить в CSV' })).toBeInTheDocument();
    });

    it('has no «Банки» row unless App passes onOpenBanking', () => {
        renderMenu();

        expect(screen.queryByRole('button', { name: /Банки/ })).not.toBeInTheDocument();
    });

    it('shows the «Банки» row with the pending count and opens it', () => {
        const onOpenBanking = vi.fn();
        renderMenu({ onOpenBanking, pendingBankingCount: 3 });

        const row = screen.getByRole('button', { name: /^Банки/ });
        expect(row).toHaveTextContent('предложений: 3');
        fireEvent.click(row);
        expect(onOpenBanking).toHaveBeenCalledTimes(1);
    });

    it('omits the pending badge when there is nothing to review', () => {
        renderMenu({ onOpenBanking: () => { }, pendingBankingCount: 0 });

        expect(screen.getByRole('button', { name: /^Банки/ })).not.toHaveTextContent('предложений');
    });
    describe('скорость загрузки', () => {
        const timing = {
            page: { responseStart: 120.4, fromCache: true, viaWorker: true },
            dataReadyAt: 1234.6,
            startupRequests: [
                { path: '/api/accounts', duration: 90.2, startTime: 130, serverTiming: [{ name: 'db', duration: 12 }] },
                {
                    path: '/api/stats/dashboard', duration: 839.7, startTime: 140,
                    serverTiming: [{ name: 'db', duration: 310 }, { name: 'calc', duration: 120 }],
                },
            ],
            recentRequests: [{ path: '/api/history', duration: 60, startTime: 5000, serverTiming: [] }],
        };

        it('без readLoadTiming раздела нет', () => {
            renderMenu();
            expect(screen.queryByRole('heading', { level: 2, name: 'Скорость загрузки' })).not.toBeInTheDocument();
        });

        it('показывает страницу, первые данные и строки запросов из переданных значений', () => {
            renderMenu({ readLoadTiming: () => timing });

            expect(screen.getByRole('heading', { level: 2, name: 'Скорость загрузки' })).toBeInTheDocument();
            expect(screen.getByText('Страница: 120 мс (из кеша)')).toBeInTheDocument();
            expect(screen.getByText(/^Первые данные: 1\s235 мс после запуска$/)).toBeInTheDocument();
            expect(screen.getByText('/api/stats/dashboard — 840 мс (сервер: база 310, расчет 120)')).toBeInTheDocument();
            expect(screen.getByText('/api/accounts — 90 мс (сервер: база 12)')).toBeInTheDocument();
            expect(screen.getByRole('heading', { level: 3, name: 'Последние запросы' })).toBeInTheDocument();
            expect(screen.getByText('/api/history — 60 мс')).toBeInTheDocument();
        });

        it('говорит, что данных ещё нет, и не падает без записей', () => {
            renderMenu({
                readLoadTiming: () => ({ page: null, dataReadyAt: null, startupRequests: [], recentRequests: [] }),
            });
            expect(screen.getByText('Страница: нет данных')).toBeInTheDocument();
            expect(screen.getByText('Первые данные: еще не получены')).toBeInTheDocument();
            expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
        });

        it('читает замер при открытии и заново по кнопке «Обновить»', () => {
            const read = vi.fn(() => timing);
            renderMenu({ readLoadTiming: read });
            expect(read).toHaveBeenCalledTimes(1);

            read.mockReturnValue({ ...timing, recentRequests: [{ path: '/api/settings', duration: 5, startTime: 9000, serverTiming: [] }] });
            fireEvent.click(screen.getByRole('button', { name: 'Обновить замеры' }));

            expect(read).toHaveBeenCalledTimes(2);
            expect(screen.getByText('/api/settings — 5 мс')).toBeInTheDocument();
            // Кнопка «Обновить» блока «Данные» остаётся одна под своим именем.
            expect(screen.getAllByRole('button', { name: 'Обновить' })).toHaveLength(1);
        });
    });
});
