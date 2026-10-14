import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MonthReviewCard from './MonthReviewCard';

const points = [
    { text: 'Расходы составили €2 386 при обычных €1 175.', category: null },
    { text: 'Отель Booking.com на €1 200 в категории «Отпуск».', category: 'Отпуск' },
];

const renderCard = (props = {}) => render(
    <MonthReviewCard
        month="2026-09"
        headline="Сентябрь: на €1 211 больше обычного"
        points={points}
        onOpenCategory={() => { }}
        onDismiss={() => { }}
        {...props}
    />
);

describe('MonthReviewCard', () => {
    it('is a labelled section: month label, headline as its title and the points as a list', () => {
        renderCard();

        const section = screen.getByRole('region', { name: 'Сентябрь: на €1 211 больше обычного' });
        expect(within(section).getByText('Итоги сентября')).toBeInTheDocument();
        expect(within(section).getByRole('heading', { name: 'Сентябрь: на €1 211 больше обычного' })).toBeInTheDocument();
        const items = within(within(section).getByRole('list')).getAllByRole('listitem');
        expect(items).toHaveLength(2);
        expect(items[0]).toHaveTextContent('Расходы составили €2 386 при обычных €1 175.');
        expect(items[1]).toHaveTextContent('Отель Booking.com на €1 200 в категории «Отпуск».');
    });

    it('names the month in the genitive case, including a December review', () => {
        renderCard({ month: '2025-12' });
        expect(screen.getByText('Итоги декабря')).toBeInTheDocument();
    });

    it('turns a point with a category into a button that reports the category', () => {
        const onOpenCategory = vi.fn();
        renderCard({ onOpenCategory });

        fireEvent.click(screen.getByRole('button', { name: /Отель Booking\.com/ }));
        expect(onOpenCategory).toHaveBeenCalledTimes(1);
        expect(onOpenCategory).toHaveBeenCalledWith('Отпуск');
    });

    it('keeps a point without a category as plain text, not a button', () => {
        renderCard();

        expect(screen.getByText('Расходы составили €2 386 при обычных €1 175.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Расходы составили/ })).not.toBeInTheDocument();
        // кнопок две: пункт с категорией и крестик
        expect(screen.getAllByRole('button')).toHaveLength(2);
    });

    it('closes through the labelled 44px button', () => {
        const onDismiss = vi.fn();
        renderCard({ onDismiss });

        const close = screen.getByRole('button', { name: 'Скрыть итоги месяца' });
        expect(close).toHaveStyle({ minWidth: '44px', minHeight: '44px' });
        fireEvent.click(close);
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });
});
