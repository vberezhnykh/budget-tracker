import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MoreScreen from './MoreScreen';

const renderMore = (props = {}) => render(
    <MoreScreen
        lastSyncLabel="8 окт., 09:30"
        isRefreshing={false}
        isExporting={false}
        onOpenSettings={() => { }}
        onOpenTrash={() => { }}
        onRefresh={() => { }}
        onExport={() => { }}
        onLogout={() => { }}
        {...props}
    />
);

describe('MoreScreen', () => {
    it('titles the screen «Ещё» without a back button', () => {
        renderMore();

        expect(screen.getByRole('heading', { level: 1, name: 'Ещё' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /назад/i })).not.toBeInTheDocument();
    });

    it('opens settings and the trash from their rows', () => {
        const onOpenSettings = vi.fn();
        const onOpenTrash = vi.fn();
        renderMore({ onOpenSettings, onOpenTrash });

        fireEvent.click(screen.getByRole('button', { name: /Счета, категории и лимит/ }));
        fireEvent.click(screen.getByRole('button', { name: /Корзина/ }));

        expect(onOpenSettings).toHaveBeenCalledTimes(1);
        expect(onOpenTrash).toHaveBeenCalledTimes(1);
    });

    it('does not offer a banks row', () => {
        renderMore();
        expect(screen.queryByText(/Банк/)).not.toBeInTheDocument();
    });

    it('shows the last sync time and refreshes only through its own button', () => {
        const onRefresh = vi.fn();
        renderMore({ onRefresh });

        expect(screen.getByText('Синхронизировано')).toBeInTheDocument();
        expect(screen.getByText('8 окт., 09:30')).toBeInTheDocument();
        // Строка - не кнопка: вложенных кнопок быть не должно.
        expect(screen.queryByRole('button', { name: /Синхронизировано/ })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
        expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('says so when there has been no sync yet, and disables the refresh button while refreshing', () => {
        renderMore({ lastSyncLabel: null, isRefreshing: true });

        expect(screen.getByText('Еще не синхронизировано')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Обновить' })).toBeDisabled();
    });

    it('exports to CSV and shows the busy state while exporting', () => {
        const onExport = vi.fn();
        const { rerender } = renderMore({ onExport });

        fireEvent.click(screen.getByRole('button', { name: /Выгрузить в CSV/ }));
        expect(onExport).toHaveBeenCalledTimes(1);

        rerender(
            <MoreScreen lastSyncLabel={null} isRefreshing={false} isExporting onOpenSettings={() => { }} onOpenTrash={() => { }}
                onRefresh={() => { }} onExport={onExport} onLogout={() => { }} />
        );
        expect(screen.getByRole('button', { name: /Экспорт…/ })).toBeDisabled();
        expect(screen.queryByText('Выгрузить в CSV')).not.toBeInTheDocument();
    });

    it('logs out from the separate «Выйти» button', () => {
        const onLogout = vi.fn();
        renderMore({ onLogout });

        fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));

        expect(onLogout).toHaveBeenCalledTimes(1);
    });
});
