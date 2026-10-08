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
});
