import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ListRow from './ListRow';

describe('ListRow', () => {
    it('renders a plain div with title, subtitle and trailing when it has no action', () => {
        render(<ListRow title="Валюта" subtitle="Основная" trailing={<span>EUR</span>} />);

        expect(screen.getByText('Валюта')).toBeInTheDocument();
        expect(screen.getByText('Основная')).toBeInTheDocument();
        expect(screen.getByText('EUR')).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('renders a button and fires onClick when onClick is given', () => {
        const onClick = vi.fn();
        render(<ListRow title="Категории" onClick={onClick} />);

        const row = screen.getByRole('button', { name: /Категории/ });
        expect(row).toHaveAttribute('type', 'button');
        fireEvent.click(row);
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('renders a link when href is given', () => {
        render(<ListRow title="Справка" href="#/help" />);

        const row = screen.getByRole('link', { name: /Справка/ });
        expect(row).toHaveAttribute('href', '#/help');
    });

    it('shows a chevron and a bottom divider only when asked', () => {
        const { container, rerender } = render(<ListRow title="Строка" onClick={() => {}} />);
        const row = screen.getByRole('button');
        expect(container.querySelector('svg')).toBeNull();
        expect(row.style.borderBottom).not.toContain('var(--color-border-subtle)');

        rerender(<ListRow title="Строка" onClick={() => {}} chevron divider />);
        expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
        expect(screen.getByRole('button').style.borderBottom).toContain('var(--color-border-subtle)');
    });

    it('keeps at least 44px of height for touch', () => {
        render(<ListRow title="Строка" onClick={() => {}} />);
        expect(screen.getByRole('button').style.minHeight).toBe('44px');
    });
});
