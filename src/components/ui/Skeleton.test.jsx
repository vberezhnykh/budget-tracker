import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AppSkeleton } from './Skeleton';

describe('AppSkeleton', () => {
  it('отдаёт один status с подписью загрузки и прячет блоки от чтения', () => {
    const { container } = render(<AppSkeleton />);
    const status = screen.getByRole('status', { name: 'Загрузка приложения…' });
    expect(status).toBeInTheDocument();
    expect(container.firstChild).toHaveAttribute('aria-busy', 'true');
    expect(status.querySelector(':scope > [aria-hidden="true"]')).not.toBeNull();
  });

  it('повторяет Обзор: три карточки счетов, три строки операций, заглушка нижней панели', () => {
    const { container } = render(<AppSkeleton />);
    expect(container.querySelectorAll('.skeleton-chip')).toHaveLength(3);
    expect(container.querySelectorAll('.skeleton-recent .skeleton-row')).toHaveLength(3);
    expect(container.querySelector('.skeleton-nav')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.skeleton-dots')).toBeNull();
  });
});
