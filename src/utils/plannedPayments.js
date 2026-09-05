export function toLocalDateInput(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function plannedDateKey(value) {
  if (typeof value !== 'string') return '';
  return value.slice(0, 10);
}

export function groupPlannedPayments(payments, now = new Date()) {
  const today = toLocalDateInput(now);
  const monthEnd = `${today.slice(0, 7)}-31`;
  const pending = payments
    .filter(payment => payment.status === 'pending')
    .sort((a, b) => plannedDateKey(a.dueDate).localeCompare(plannedDateKey(b.dueDate)));

  return {
    overdue: pending.filter(payment => plannedDateKey(payment.dueDate) < today),
    upcoming: pending.filter(payment => plannedDateKey(payment.dueDate) >= today),
    history: payments
      .filter(payment => payment.status === 'paid' || payment.status === 'skipped')
      .sort((a, b) => plannedDateKey(b.paidAt || b.dueDate).localeCompare(plannedDateKey(a.paidAt || a.dueDate))),
    pendingThroughMonth: pending
      .filter(payment => plannedDateKey(payment.dueDate) <= monthEnd)
      .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0),
  };
}

