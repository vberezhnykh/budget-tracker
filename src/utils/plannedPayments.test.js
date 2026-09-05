import { describe, expect, it } from 'vitest';
import { groupPlannedPayments, toLocalDateInput } from './plannedPayments';

describe('planned payment date helpers', () => {
  it('uses the local calendar date instead of UTC', () => {
    const localLateEvening = new Date(2026, 0, 31, 23, 30);
    expect(toLocalDateInput(localLateEvening)).toBe('2026-01-31');
  });

  it('includes overdue pending payments and this month, but not later months, in the total', () => {
    const payments = [
      { _id: 'old', status: 'pending', dueDate: '2025-12-10T00:00:00.000Z', amount: 10 },
      { _id: 'month', status: 'pending', dueDate: '2026-01-30T00:00:00.000Z', amount: 20 },
      { _id: 'later', status: 'pending', dueDate: '2026-02-01T00:00:00.000Z', amount: 30 },
      { _id: 'paid', status: 'paid', dueDate: '2026-01-12T00:00:00.000Z', amount: 40 },
    ];

    const grouped = groupPlannedPayments(payments, new Date(2026, 0, 15, 12));
    expect(grouped.overdue.map(payment => payment._id)).toEqual(['old']);
    expect(grouped.upcoming.map(payment => payment._id)).toEqual(['month', 'later']);
    expect(grouped.pendingThroughMonth).toBe(30);
    expect(grouped.history.map(payment => payment._id)).toEqual(['paid']);
  });
});
