import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import SplitEditor from './SplitEditor';
import useSplits from './useSplits';

const categories = ['Продукты', 'Транспорт', 'Дом', 'Кафе'].map(name => ({ _id: name, name, type: 'expense' }));

function Editor({ total = '100' }) {
    const split = useSplits(total);
    return <SplitEditor split={split} categories={categories} transactions={[]} type="expense" />;
}

const category = index => screen.getByLabelText(`Категория части ${index}`);
const amount = index => screen.getByLabelText(`Сумма части ${index}`);
const optionNames = select => within(select).getAllByRole('option').map(option => option.textContent);

afterEach(cleanup);

describe('split editor', () => {
    it('gives each part a category select, an amount and a labelled remove button only from three parts', () => {
        render(<Editor />);
        expect(category(1).tagName).toBe('SELECT');
        expect(amount(1)).toHaveAttribute('type', 'number');
        expect(screen.queryByRole('button', { name: /Удалить часть/ })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Добавить часть' }));
        expect(category(3)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Удалить часть 3' }));
        expect(screen.queryByLabelText('Категория части 3')).toBeNull();
        expect(screen.queryByRole('button', { name: /Удалить часть/ })).toBeNull();
    });

    it('shows the placeholder only while empty and offers no category taken by another part', () => {
        render(<Editor />);
        expect(optionNames(category(1))).toEqual(['Категория', 'Продукты', 'Транспорт', 'Дом', 'Кафе']);
        expect(within(category(1)).getByRole('option', { name: 'Категория' })).toBeDisabled();

        fireEvent.change(category(1), { target: { value: 'Продукты' } });
        expect(category(1)).toHaveValue('Продукты');
        expect(optionNames(category(1))).toEqual(['Продукты', 'Транспорт', 'Дом', 'Кафе']);
        expect(optionNames(category(2))).toEqual(['Категория', 'Транспорт', 'Дом', 'Кафе']);
        // выбранная категория видна в нарисованном поле
        expect(category(1).parentElement).toHaveTextContent('Продукты');
    });

    it('reads «Осталось распределить» while there is something left', () => {
        render(<Editor />);
        fireEvent.change(amount(1), { target: { value: '30' } });
        const status = screen.getByRole('status');
        expect(status).toHaveTextContent('Осталось распределить');
        expect(status).toHaveTextContent('€70,00');
        expect(status).toHaveStyle({ background: 'var(--color-warning-soft)', color: 'var(--color-warning-text)' });
    });

    it('reads «Распределено полностью» with the total when everything is spread', () => {
        render(<Editor />);
        fireEvent.change(amount(1), { target: { value: '30' } });
        fireEvent.change(amount(2), { target: { value: '70' } });
        const status = screen.getByRole('status');
        expect(status).toHaveTextContent('Распределено полностью');
        expect(status).toHaveTextContent('€100,00');
        expect(status).toHaveStyle({ background: 'var(--color-positive-soft)', color: 'var(--color-positive)' });
    });

    it('reads how much the parts exceed the total by, as a positive amount', () => {
        render(<Editor />);
        fireEvent.change(amount(1), { target: { value: '80' } });
        fireEvent.change(amount(2), { target: { value: '45.5' } });
        const status = screen.getByRole('status');
        expect(status).toHaveTextContent('Части больше общей суммы на');
        expect(status).toHaveTextContent('€25,50');
        expect(status).not.toHaveTextContent('−');
        expect(status).toHaveStyle({ background: 'var(--color-warning-soft)' });
    });
});
