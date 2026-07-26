import { arrayMove } from '@dnd-kit/sortable'

// Kept in its own module (rather than inline in App.jsx) so these functions
// stay unit-testable without pulling in React, and so App.jsx - which also
// exports the App component - doesn't mix component and non-component
// exports (that trips react-refresh's only-export-components rule).

// Pure reorder computation: given the accounts in their current display
// order plus the ids dnd-kit reports as dragged/dropped-on, returns the
// reordered list (with `order` recomputed) and only the subset of accounts
// whose `order` actually changed vs. their current value - that subset is
// what the caller should persist.
export function computeAccountReorder(accounts, activeId, overId) {
  const oldIndex = accounts.findIndex(acc => acc._id === activeId);
  const newIndex = accounts.findIndex(acc => acc._id === overId);

  if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
    return { reordered: accounts, changed: [] };
  }

  // Reuse the existing `order` values as positional slots rather than
  // renumbering 0..n from scratch, so accounts outside the moved range keep
  // the exact `order` they already had (and so don't need a PUT).
  const orderSlots = accounts.map(acc => acc.order);
  const moved = arrayMove(accounts, oldIndex, newIndex);
  const reordered = moved.map((acc, index) => ({ ...acc, order: orderSlots[index] }));

  const changed = reordered.filter(acc => {
    const original = accounts.find(a => a._id === acc._id);
    return original && original.order !== acc.order;
  });

  return { reordered, changed };
}

// The dnd-kit onDragEnd handler's actual logic, extracted so it can be
// invoked directly in tests without a real pointer/keyboard drag (jsdom
// can't provide the layout measurements dnd-kit's sensors rely on).
// Persists only the accounts whose order changed, updates state
// optimistically, and rolls back on failure - mirroring the
// handleSaveAccount/handleDeleteAccount error convention in App.jsx (alert
// with the server's message, or a fallback, on a non-ok response;
// console.error on a network exception).
export async function handleAccountDragEnd({ active, over }, { accounts, setAccounts, apiUrl = '/api/accounts' }) {
  if (!active || !over) return;

  const { reordered, changed } = computeAccountReorder(accounts, active.id, over.id);
  if (changed.length === 0) return;

  setAccounts(reordered);

  try {
    const responses = await Promise.all(changed.map(acc =>
      fetch(`${apiUrl}/${acc._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: acc.order })
      })
    ));
    const failedRes = responses.find(res => !res.ok);
    if (failedRes) {
      setAccounts(accounts);
      const err = await failedRes.json().catch(() => ({}));
      alert(err.message || 'Не удалось сохранить порядок счетов');
    }
  } catch (err) {
    console.error('Reorder accounts error:', err);
    setAccounts(accounts);
  }
}
