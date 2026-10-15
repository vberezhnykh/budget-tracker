import { describe, expect, it } from 'vitest';
import {
    activeUndo,
    cleanupRowSubtitle,
    companiesLabel,
    formatCleanupDate,
    groupProposals,
    keysToSend,
    operationsLabel,
    selectAll,
    selectableKeys,
    selectedOperations,
    selectionState,
    toggleKey,
    toggleKeys,
    undoDeadline,
} from './cleanupReview';

const proposal = (key, kind, count, extra = {}) => ({
    key,
    text: key.toUpperCase(),
    variants: [key.toUpperCase()],
    count,
    total: count * 10,
    categories: [],
    kind,
    company: null,
    note: null,
    source: 'claude',
    reason: null,
    ...extra,
});

const PROPOSALS = [
    proposal('lidl nicosia', 'existing', 12, { company: 'Lidl' }),
    proposal('лидл', 'existing', 8, { company: 'lidl', note: 'продукты' }),
    proposal('икеа', 'new', 5, { company: 'IKEA' }),
    proposal('продукты', 'note', 30),
    proposal('бензин', 'note', 4),
    proposal('???', 'skip', 2, { reason: 'no_result' }),
];

describe('groupProposals', () => {
    it('groups existing and new proposals by target company, keeping the server order', () => {
        const { companies } = groupProposals(PROPOSALS);

        expect(companies.map(group => group.name)).toEqual(['Lidl', 'IKEA']);
        expect(companies[0]).toMatchObject({ count: 20, keys: ['lidl nicosia', 'лидл'], isNew: false });
        expect(companies[0].items).toHaveLength(2);
        expect(companies[1]).toMatchObject({ count: 5, keys: ['икеа'], isNew: true });
    });

    it('merges company names that differ only in case', () => {
        const { companies } = groupProposals([
            proposal('a', 'new', 1, { company: 'Wolt' }),
            proposal('b', 'new', 2, { company: 'WOLT' }),
        ]);
        expect(companies).toHaveLength(1);
        expect(companies[0]).toMatchObject({ name: 'Wolt', count: 3, isNew: true });
    });

    it('does not call a company new when any of its texts matched the directory', () => {
        const { companies } = groupProposals([
            proposal('a', 'existing', 1, { company: 'Wolt' }),
            proposal('b', 'new', 2, { company: 'Wolt' }),
        ]);
        expect(companies[0].isNew).toBe(false);
    });

    it('splits notes and skipped, and treats broken company proposals as skipped', () => {
        const { notes, skipped } = groupProposals([
            ...PROPOSALS,
            proposal('x', 'existing', 1, { company: null }),
            proposal('y', 'weird', 1),
        ]);
        expect(notes.map(item => item.key)).toEqual(['продукты', 'бензин']);
        expect(skipped.map(item => item.key)).toEqual(['???', 'x', 'y']);
    });

    it('survives missing input', () => {
        expect(groupProposals(undefined)).toEqual({ companies: [], notes: [], skipped: [] });
    });
});

describe('selection', () => {
    const review = groupProposals(PROPOSALS);

    it('lists selectable keys without skipped ones, and selects them all by default', () => {
        expect(selectableKeys(review)).toEqual(['lidl nicosia', 'лидл', 'икеа', 'продукты', 'бензин']);
        expect([...selectAll(review)]).toEqual(selectableKeys(review));
    });

    it('toggles one key without touching the original set', () => {
        const all = selectAll(review);
        const without = toggleKey(all, 'икеа');
        expect(without.has('икеа')).toBe(false);
        expect(all.has('икеа')).toBe(true);
        expect(toggleKey(without, 'икеа').has('икеа')).toBe(true);
    });

    it('reports none, some and all for a group', () => {
        const keys = ['lidl nicosia', 'лидл'];
        expect(selectionState(new Set(), keys)).toBe('none');
        expect(selectionState(new Set(['лидл']), keys)).toBe('some');
        expect(selectionState(new Set(keys), keys)).toBe('all');
    });

    it('toggles a group: all -> none, some or none -> all', () => {
        const keys = ['lidl nicosia', 'лидл'];
        expect(selectionState(toggleKeys(new Set(keys), keys), keys)).toBe('none');
        expect(selectionState(toggleKeys(new Set(['лидл']), keys), keys)).toBe('all');
        expect(selectionState(toggleKeys(new Set(), keys), keys)).toBe('all');
    });

    it('keeps other keys when a group is toggled', () => {
        const next = toggleKeys(new Set(['икеа', 'лидл']), ['lidl nicosia', 'лидл']);
        expect([...next].sort()).toEqual(['lidl nicosia', 'икеа', 'лидл'].sort());
    });

    it('counts operations of the selected keys only', () => {
        expect(selectedOperations(selectAll(review), review)).toBe(12 + 8 + 5 + 30 + 4);
        expect(selectedOperations(new Set(['икеа', 'бензин']), review)).toBe(9);
        expect(selectedOperations(new Set(), review)).toBe(0);
    });

    it('does not count skipped or unknown keys', () => {
        expect(selectedOperations(new Set(['???', 'нет такого']), review)).toBe(0);
    });

    it('sends the selected keys in server order and ignores unknown ones', () => {
        expect(keysToSend(new Set(['бензин', 'икеа', '???', 'unknown']), review)).toEqual(['икеа', 'бензин']);
        expect(keysToSend(new Set(), review)).toEqual([]);
    });
});

describe('labels', () => {
    it('uses the right Russian form of «операция» in each case', () => {
        expect(operationsLabel(1)).toBe('1 операция');
        expect(operationsLabel(3)).toBe('3 операции');
        expect(operationsLabel(11)).toBe('11 операций');
        expect(operationsLabel(1, 'genitive')).toBe('1 операции');
        expect(operationsLabel(7, 'genitive')).toBe('7 операций');
        expect(operationsLabel(1, 'accusative')).toBe('1 операцию');
        expect(operationsLabel(22, 'accusative')).toBe('22 операции');
        expect(operationsLabel(21, 'dative')).toBe('21 операции');
        expect(operationsLabel(5, 'dative')).toBe('5 операциям');
        expect(operationsLabel(0, 'dative')).toBe('0 операциям');
    });

    it('pluralises companies', () => {
        expect([1, 2, 5, 12].map(companiesLabel)).toEqual(['1 компания', '2 компании', '5 компаний', '12 компаний']);
    });

    it('formats the day without a year in the current year and with it otherwise', () => {
        const now = new Date('2026-10-15T12:00:00');
        expect(formatCleanupDate('2026-11-14T12:00:00.000Z', now)).toBe('14 ноября');
        expect(formatCleanupDate('2027-01-05T12:00:00.000Z', now)).toBe('5 января 2027 г.');
        expect(formatCleanupDate('not a date', now)).toBe('');
    });

    it('puts the undo deadline 30 days after today', () => {
        const now = new Date('2026-10-15T12:00:00');
        expect(formatCleanupDate(undoDeadline(now), now)).toBe('14 ноября');
    });
});

describe('activeUndo', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    const undo = { runId: 'r1', appliedAt: '2026-10-15T10:00:00.000Z', undoUntil: '2026-11-14T12:00:00.000Z', stats: {} };

    it('returns the server undo while its window is open, whatever the latest run is', () => {
        expect(activeUndo({ run: { status: 'submitted' }, undo }, now)).toBe(undo);
        expect(activeUndo({ run: null, undo }, now)).toBe(undo);
    });

    it('is null without undo, with an expired window or without a date', () => {
        expect(activeUndo({ run: null, undo: null }, now)).toBeNull();
        expect(activeUndo({ run: null }, now)).toBeNull();
        expect(activeUndo(null, now)).toBeNull();
        expect(activeUndo({ undo: { ...undo, undoUntil: '2026-10-14T12:00:00.000Z' } }, now)).toBeNull();
        expect(activeUndo({ undo: { ...undo, undoUntil: null } }, now)).toBeNull();
    });
});

describe('cleanupRowSubtitle', () => {
    const now = new Date('2026-10-15T12:00:00Z');

    it('is null when there is nothing to do', () => {
        expect(cleanupRowSubtitle(null, now)).toBeNull();
        expect(cleanupRowSubtitle({ legacyCount: 0, run: null }, now)).toBeNull();
        expect(cleanupRowSubtitle({ legacyCount: 0, run: { status: 'reverted' } }, now)).toBeNull();
        expect(cleanupRowSubtitle({ legacyCount: 0, run: { status: 'failed' } }, now)).toBeNull();
    });

    it('puts a run in progress before the count', () => {
        expect(cleanupRowSubtitle({ legacyCount: 9, run: { status: 'submitted' } }, now)).toBe('Claude разбирает описания');
        expect(cleanupRowSubtitle({ legacyCount: 9, run: { status: 'ready' } }, now)).toBe('Готово к просмотру');
    });

    it('offers undo from the server undo field and the count once the window is over', () => {
        const undo = { runId: 'r1', undoUntil: '2026-11-14T12:00:00.000Z', stats: {} };
        expect(cleanupRowSubtitle({ legacyCount: 3, run: { status: 'applied' }, undo }, now)).toBe('Можно отменить до 14 ноября');
        expect(cleanupRowSubtitle({ legacyCount: 3, run: { status: 'applied' }, undo: null }, now)).toBe('3 операции без компании');
        expect(cleanupRowSubtitle({ legacyCount: 3, run: { status: 'failed' }, undo }, now)).toBe('Можно отменить до 14 ноября');
    });

    it('keeps a run in progress before the undo date', () => {
        const undo = { runId: 'r1', undoUntil: '2026-11-14T12:00:00.000Z', stats: {} };
        expect(cleanupRowSubtitle({ legacyCount: 3, run: { status: 'submitted' }, undo }, now)).toBe('Claude разбирает описания');
    });

    it('counts legacy operations when there is no run', () => {
        expect(cleanupRowSubtitle({ legacyCount: 25, run: null }, now)).toBe('25 операций без компании');
    });
});
