import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CleanupScreen from './CleanupScreen';

const NOW = new Date('2026-10-15T12:00:00');

const proposal = (key, kind, count, extra = {}) => ({
    key,
    text: extra.text || key,
    variants: [extra.text || key],
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

const READY_PROPOSALS = [
    proposal('lidl nicosia', 'existing', 12, { text: 'LIDL NICOSIA', variants: ['LIDL NICOSIA', 'Лидл'], company: 'Lidl' }),
    proposal('лидл', 'existing', 8, { text: 'лидл продукты', company: 'Lidl', note: 'продукты' }),
    proposal('икеа', 'new', 5, { text: 'ИКЕА', company: 'IKEA' }),
    proposal('продукты', 'note', 30, { text: 'Продукты' }),
    proposal('бензин', 'note', 4, { text: 'Бензин' }),
    proposal('???', 'skip', 2, { text: '???', reason: 'no_result' }),
];

const run = (status, extra = {}) => ({
    id: 'run-1',
    status,
    createdAt: '2026-10-15T08:00:00.000Z',
    undoUntil: null,
    undoExpired: false,
    stats: {},
    ...extra,
});

const ready = (extra = {}) => ({ legacyCount: 59, legacyTexts: 6, run: run('ready', { proposals: READY_PROPOSALS, ...extra }) });
const APPLY_STATS = { apply: { updated: 55, companiesCreated: 1, skippedChanged: 0 } };
const undoOf = (stats = APPLY_STATS) => ({ runId: 'run-0', appliedAt: '2026-10-15T08:00:00.000Z', undoUntil: '2026-11-14T12:00:00.000Z', stats });
const applied = ({ stats = APPLY_STATS, undo = true } = {}) => ({
    legacyCount: 0,
    legacyTexts: 0,
    run: run('applied', { id: 'run-0', undoUntil: '2026-11-14T12:00:00.000Z', stats }),
    undo: undo ? undoOf(stats) : null,
});

const ok = (data = {}) => vi.fn().mockResolvedValue({ ok: true, data });

const renderScreen = ({ summary, loading = false, error = '', ...props } = {}) => render(
    <CleanupScreen
        state={{ summary, loading, error }}
        now={NOW}
        onBack={() => { }}
        onRefresh={vi.fn().mockResolvedValue(true)}
        onStart={ok()}
        onApply={ok({ updated: 55, companiesCreated: 1, skippedChanged: 0 })}
        onRevert={ok({ restored: 55, companiesDeleted: 1, skippedChanged: 0 })}
        {...props}
    />
);

const checkbox = (name) => screen.getByRole('checkbox', { name });

afterEach(() => vi.restoreAllMocks());

describe('CleanupScreen: header and loading', () => {
    it('shows the title and a back button labelled «Ещё»', () => {
        const onBack = vi.fn();
        renderScreen({ summary: { legacyCount: 3, run: null }, onBack });

        expect(screen.getByRole('heading', { level: 1, name: 'Старые описания' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Ещё/ }));
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('shows a skeleton while the first read is in flight', () => {
        renderScreen({ summary: null, loading: true });
        expect(screen.getByRole('status', { name: 'Загрузка…' })).toBeInTheDocument();
    });

    it('shows the error with a retry button when the read failed', () => {
        const onRefresh = vi.fn().mockResolvedValue(true);
        renderScreen({ summary: null, error: 'Не удалось загрузить состояние чистки', onRefresh });

        expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить состояние чистки');
        fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
        expect(onRefresh).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('status', { name: 'Загрузка…' })).not.toBeInTheDocument();
    });

    it('keeps showing the data above a failed refresh', () => {
        renderScreen({ summary: ready(), error: 'Не удалось загрузить состояние чистки' });
        expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить');
        expect(screen.getByRole('heading', { level: 2, name: 'Компании' })).toBeInTheDocument();
    });

    it('re-reads when the window gets focus or becomes visible, and not while hidden', () => {
        const onRefresh = vi.fn().mockResolvedValue(true);
        renderScreen({ summary: { legacyCount: 3, run: run('submitted') }, onRefresh });

        fireEvent.focus(window);
        expect(onRefresh).toHaveBeenCalledTimes(1);
        fireEvent(document, new Event('visibilitychange'));
        expect(onRefresh).toHaveBeenCalledTimes(2);

        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        fireEvent(document, new Event('visibilitychange'));
        expect(onRefresh).toHaveBeenCalledTimes(2);
    });
});

describe('CleanupScreen: nothing started', () => {
    it('explains what will happen and what is sent to Claude', () => {
        renderScreen({ summary: { legacyCount: 59, run: null } });

        expect(screen.getByText(/У 59 операций, внесенных до появления компаний/)).toBeInTheDocument();
        expect(screen.getByText(/Ничего не изменится, пока вы не просмотрите и не подтвердите список/)).toBeInTheDocument();
        expect(screen.getByText(/Claude получит только тексты описаний, их категории и число операций/)).toBeInTheDocument();
        expect(screen.getByText(/Суммы и даты не отправляются/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Разобрать' })).toBeEnabled();
        expect(screen.queryByText('Прошлый разбор не удался')).not.toBeInTheDocument();
    });

    it('says so after a failed run and still offers a new one', () => {
        renderScreen({ summary: { legacyCount: 4, run: run('failed') } });
        expect(screen.getByText('Прошлый разбор не удался')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Разобрать' })).toBeInTheDocument();
    });

    it('treats a reverted run like no run', () => {
        renderScreen({ summary: { legacyCount: 4, run: run('reverted') } });
        expect(screen.getByRole('button', { name: 'Разобрать' })).toBeInTheDocument();
    });

    it('says there is nothing to clean when no old texts are left', () => {
        renderScreen({ summary: { legacyCount: 0, run: null } });
        expect(screen.getByText('Разбирать нечего')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Разобрать' })).not.toBeInTheDocument();
    });

    it('starts a run and blocks a second tap while it is in flight', async () => {
        let finish;
        const onStart = vi.fn(() => new Promise(resolve => { finish = resolve; }));
        renderScreen({ summary: { legacyCount: 59, run: null }, onStart });

        fireEvent.click(screen.getByRole('button', { name: 'Разобрать' }));
        const busy = screen.getByRole('button', { name: 'Отправляем…' });
        expect(busy).toBeDisabled();
        fireEvent.click(busy);
        expect(onStart).toHaveBeenCalledTimes(1);

        await act(async () => finish({ ok: true, data: {} }));
        expect(screen.getByRole('button', { name: 'Разобрать' })).toBeEnabled();
    });

    it.each([
        ['409', 'Предыдущая чистка еще не закончена.'],
        ['429', 'Дневной лимит запусков чистки исчерпан.'],
        ['503', 'Чистка описаний не настроена.'],
    ])('shows the server message for %s and lets the user try again', async (_status, message) => {
        const onStart = vi.fn().mockResolvedValue({ ok: false, error: message });
        renderScreen({ summary: { legacyCount: 59, run: null }, onStart });

        fireEvent.click(screen.getByRole('button', { name: 'Разобрать' }));
        expect(await screen.findByRole('alert')).toHaveTextContent(message);
        expect(screen.getByRole('button', { name: 'Разобрать' })).toBeEnabled();

        fireEvent.click(screen.getByRole('button', { name: 'Разобрать' }));
        expect(onStart).toHaveBeenCalledTimes(2);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Разобрать' })).toBeEnabled());
    });
});

describe('CleanupScreen: submitted', () => {
    it('tells the user to come back later and offers «Проверить»', async () => {
        const onRefresh = vi.fn().mockResolvedValue(true);
        renderScreen({ summary: { legacyCount: 59, run: run('submitted') }, onRefresh });

        expect(screen.getByText(/Claude разбирает описания\. Обычно это занимает до часа\. Можно закрыть приложение и вернуться позже\./)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Разобрать' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Проверить' }));
        await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
        expect(await screen.findByText(/пока не готово/)).toBeInTheDocument();
    });
});

describe('CleanupScreen: review', () => {
    it('groups proposals into sections with everything selectable selected', () => {
        renderScreen({ summary: ready() });

        expect(screen.getByRole('heading', { level: 2, name: 'Компании' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 2, name: 'Останутся описанием' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 2, name: 'Без ответа' })).toBeInTheDocument();

        const lidl = screen.getByRole('group', { name: 'Компания Lidl' });
        expect(within(lidl).getAllByRole('checkbox')).toHaveLength(3);
        expect(within(lidl).getByText('20 операций')).toBeInTheDocument();
        expect(within(lidl).queryByText('новая')).not.toBeInTheDocument();
        expect(within(lidl).getByText('также: Лидл')).toBeInTheDocument();
        expect(within(lidl).getByText('останется комментарий: продукты')).toBeInTheDocument();

        const ikea = screen.getByRole('group', { name: 'Компания IKEA' });
        expect(within(ikea).getByText('новая')).toBeInTheDocument();

        for (const box of screen.getAllByRole('checkbox')) expect(box).toBeChecked();
        expect(screen.getByText('У этих операций не будет компании, текст останется комментарием')).toBeInTheDocument();
    });

    it('lists skipped texts without checkboxes', () => {
        renderScreen({ summary: ready() });

        const section = screen.getByRole('heading', { name: 'Без ответа' }).closest('section');
        expect(within(section).getByText('???')).toBeInTheDocument();
        expect(within(section).queryByRole('checkbox')).not.toBeInTheDocument();
        expect(within(section).getByText('Claude не ответил по этим описаниям, их можно разобрать позже')).toBeInTheDocument();
    });

    it('omits empty sections', () => {
        renderScreen({ summary: ready({ proposals: [proposal('икеа', 'new', 5, { company: 'IKEA', text: 'ИКЕА' })] }) });

        expect(screen.queryByRole('heading', { name: 'Останутся описанием' })).not.toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Без ответа' })).not.toBeInTheDocument();
    });

    it('counts the selected operations on the button and disables it at zero', () => {
        renderScreen({ summary: ready() });
        expect(screen.getByRole('button', { name: 'Применить к 59 операциям' })).toBeEnabled();

        fireEvent.click(checkbox(/^ИКЕА/));
        expect(screen.getByRole('button', { name: 'Применить к 54 операциям' })).toBeEnabled();

        fireEvent.click(checkbox(/^Бензин/));
        expect(screen.getByRole('button', { name: 'Применить к 50 операциям' })).toBeEnabled();

        for (const box of screen.getAllByRole('checkbox')) if (box.checked) fireEvent.click(box);
        expect(screen.getByRole('button', { name: 'Применить к 0 операциям' })).toBeDisabled();
    });

    it('toggles a whole company from its checkbox and shows the mixed state', () => {
        renderScreen({ summary: ready() });
        const lidl = screen.getByRole('group', { name: 'Компания Lidl' });
        const [groupBox, firstRow, secondRow] = within(lidl).getAllByRole('checkbox');

        expect(groupBox.indeterminate).toBe(false);
        fireEvent.click(firstRow);
        expect(groupBox.indeterminate).toBe(true);
        expect(groupBox).not.toBeChecked();
        expect(secondRow).toBeChecked();

        fireEvent.click(groupBox);
        expect(groupBox).toBeChecked();
        expect(groupBox.indeterminate).toBe(false);
        expect(firstRow).toBeChecked();

        fireEvent.click(groupBox);
        expect(groupBox).not.toBeChecked();
        expect(firstRow).not.toBeChecked();
        expect(secondRow).not.toBeChecked();
        expect(screen.getByRole('button', { name: 'Применить к 39 операциям' })).toBeInTheDocument();
    });

    it('has a section-level «Снять все» / «Выбрать все» for notes', () => {
        renderScreen({ summary: ready() });
        const notes = checkbox(/^Продукты/);
        const other = checkbox(/^Бензин/);

        fireEvent.click(screen.getByRole('button', { name: 'Снять все' }));
        expect(notes).not.toBeChecked();
        expect(other).not.toBeChecked();
        expect(checkbox(/^ИКЕА/)).toBeChecked();

        fireEvent.click(screen.getByRole('button', { name: 'Выбрать все' }));
        expect(notes).toBeChecked();
        expect(other).toBeChecked();
    });

    it('asks for confirmation with the operation count and the undo date before applying', () => {
        const onApply = ok();
        renderScreen({ summary: ready(), onApply });

        fireEvent.click(checkbox(/^ИКЕА/));
        fireEvent.click(screen.getByRole('button', { name: 'Применить к 54 операциям' }));

        expect(onApply).not.toHaveBeenCalled();
        const confirm = screen.getByRole('group', { name: 'Подтверждение' });
        expect(confirm).toHaveTextContent('Изменить 54 операции? Отменить можно до 14 ноября.');

        fireEvent.click(within(confirm).getByRole('button', { name: 'Отмена' }));
        expect(screen.queryByRole('group', { name: 'Подтверждение' })).not.toBeInTheDocument();
        expect(onApply).not.toHaveBeenCalled();
    });

    it('applies exactly the selected keys after confirmation', async () => {
        const onApply = ok({ updated: 50, companiesCreated: 0, skippedChanged: 0 });
        renderScreen({ summary: ready(), onApply });

        fireEvent.click(checkbox(/^ИКЕА/));
        fireEvent.click(checkbox(/^Бензин/));
        fireEvent.click(screen.getByRole('button', { name: 'Применить к 50 операциям' }));
        fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));

        await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
        expect(onApply).toHaveBeenCalledWith(['lidl nicosia', 'лидл', 'продукты']);
    });

    it('keeps the selection when the same run is read again', () => {
        const { rerender } = renderScreen({ summary: ready() });
        fireEvent.click(checkbox(/^ИКЕА/));

        rerender(
            <CleanupScreen
                state={{ summary: ready(), loading: true, error: '' }}
                now={NOW}
                onBack={() => { }}
                onRefresh={vi.fn()}
                onStart={vi.fn()}
                onApply={vi.fn()}
                onRevert={vi.fn()}
            />
        );
        expect(checkbox(/^ИКЕА/)).not.toBeChecked();
    });

    it('shows the server message and stays on the list when applying fails', async () => {
        const onApply = vi.fn().mockResolvedValue({ ok: false, error: 'Нет готовых предложений для применения.' });
        renderScreen({ summary: ready(), onApply });

        fireEvent.click(screen.getByRole('button', { name: 'Применить к 59 операциям' }));
        fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Нет готовых предложений для применения.');
        expect(checkbox(/^ИКЕА/)).toBeChecked();
    });

    it('does not offer applying when Claude answered nothing usable', () => {
        renderScreen({ summary: ready({ proposals: [proposal('???', 'skip', 2)] }) });
        expect(screen.queryByRole('button', { name: /Применить/ })).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Без ответа' })).toBeInTheDocument();
    });
});

describe('CleanupScreen: applied', () => {
    it('summarises the result and the undo deadline from the run', () => {
        renderScreen({ summary: applied() });

        expect(screen.getByText('Готово: изменено 55 операций, добавлено 1 компания.')).toBeInTheDocument();
        expect(screen.getByText('Отменить можно до 14 ноября.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Отменить чистку до 14 ноября' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Разобрать' })).not.toBeInTheDocument();
    });

    it('leaves out the companies clause when none were added', () => {
        renderScreen({ summary: applied({ stats: { apply: { updated: 3, companiesCreated: 0 } } }) });
        expect(screen.getByText('Готово: изменено 3 операции.')).toBeInTheDocument();
    });

    it('offers a new run for what is left', async () => {
        const onStart = ok();
        renderScreen({ summary: { ...applied(), legacyCount: 4 }, onStart });

        expect(screen.getByText('Осталось 4 операции без компании')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Разобрать' }));
        expect(onStart).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Разобрать' })).toBeEnabled());
    });

    it('asks before reverting, and cancel does nothing', () => {
        const onRevert = ok();
        renderScreen({ summary: applied(), onRevert });

        fireEvent.click(screen.getByRole('button', { name: 'Отменить чистку до 14 ноября' }));
        const confirm = screen.getByRole('group', { name: 'Подтверждение отмены' });
        expect(confirm).toHaveTextContent('Вернуть описания как было? Операции, которые вы изменили после чистки, останутся как есть.');

        fireEvent.click(within(confirm).getByRole('button', { name: 'Отмена' }));
        expect(onRevert).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Отменить чистку до 14 ноября' })).toBeInTheDocument();
    });

    it('reverts and reports how many operations came back', async () => {
        const onRevert = ok({ restored: 52, companiesDeleted: 1, skippedChanged: 0 });
        const { rerender } = renderScreen({ summary: applied(), onRevert });

        fireEvent.click(screen.getByRole('button', { name: 'Отменить чистку до 14 ноября' }));
        fireEvent.click(screen.getByRole('button', { name: 'Вернуть' }));
        await waitFor(() => expect(onRevert).toHaveBeenCalledTimes(1));
        expect(await screen.findByText('Возвращено 52 операции.')).toBeInTheDocument();

        // App перечитывает состояние: прогон отменен, старые тексты снова на месте.
        rerender(
            <CleanupScreen
                state={{ summary: { legacyCount: 55, run: run('reverted') }, loading: false, error: '' }}
                now={NOW}
                onBack={() => { }}
                onRefresh={vi.fn()}
                onStart={vi.fn()}
                onApply={vi.fn()}
                onRevert={onRevert}
            />
        );
        expect(screen.getByText('Возвращено 52 операции.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Разобрать' })).toBeInTheDocument();
    });

    it('mentions operations that were changed after the cleanup', async () => {
        const onRevert = ok({ restored: 50, companiesDeleted: 0, skippedChanged: 5 });
        renderScreen({ summary: applied(), onRevert });

        fireEvent.click(screen.getByRole('button', { name: 'Отменить чистку до 14 ноября' }));
        fireEvent.click(screen.getByRole('button', { name: 'Вернуть' }));

        expect(await screen.findByText('Возвращено 50 операций. 5 операций вы изменили после чистки - они не тронуты.')).toBeInTheDocument();
    });

    it('shows the server message when the revert fails', async () => {
        const onRevert = vi.fn().mockResolvedValue({ ok: false, error: 'Срок отмены вышел.' });
        renderScreen({ summary: applied(), onRevert });

        fireEvent.click(screen.getByRole('button', { name: 'Отменить чистку до 14 ноября' }));
        fireEvent.click(screen.getByRole('button', { name: 'Вернуть' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Срок отмены вышел.');
    });

    it('falls back to the start screen once the undo window is over', () => {
        renderScreen({ summary: { ...applied({ undo: false }), legacyCount: 6 } });

        expect(screen.queryByRole('button', { name: 'Отменить чистку до 14 ноября' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Разобрать' })).toBeInTheDocument();
    });
});

describe('CleanupScreen: undo of the previous cleanup next to a newer run', () => {
    const undoLine = 'Прошлая чистка: изменено 55 операций, добавлено 1 компания. Отменить можно до 14 ноября.';

    it.each([
        ['nothing started', () => ({ legacyCount: 4, run: null, undo: undoOf() })],
        ['a failed run', () => ({ legacyCount: 4, run: run('failed'), undo: undoOf() })],
        ['a submitted run', () => ({ legacyCount: 4, run: run('submitted'), undo: undoOf() })],
        ['a ready run', () => ({ ...ready(), undo: undoOf() })],
    ])('shows the undo section under %s', (_name, summary) => {
        renderScreen({ summary: summary() });

        const section = screen.getByRole('region', { name: 'Прошлая чистка' });
        expect(section).toHaveTextContent(undoLine);
        expect(within(section).getByRole('button', { name: 'Отменить чистку до 14 ноября' })).toBeEnabled();
    });

    it('has no undo section without undo', () => {
        renderScreen({ summary: ready() });
        expect(screen.queryByRole('region', { name: 'Прошлая чистка' })).not.toBeInTheDocument();
    });

    it('reverts from the section while a new run is ready, after the same confirmation', async () => {
        const onRevert = ok({ restored: 55, companiesDeleted: 1, skippedChanged: 0 });
        renderScreen({ summary: { ...ready(), undo: undoOf() }, onRevert });

        fireEvent.click(screen.getByRole('button', { name: 'Отменить чистку до 14 ноября' }));
        const confirm = screen.getByRole('group', { name: 'Подтверждение отмены' });
        expect(confirm).toHaveTextContent('Вернуть описания как было? Операции, которые вы изменили после чистки, останутся как есть.');
        expect(onRevert).not.toHaveBeenCalled();

        fireEvent.click(within(confirm).getByRole('button', { name: 'Вернуть' }));
        await waitFor(() => expect(onRevert).toHaveBeenCalledTimes(1));
        expect(await screen.findByText('Возвращено 55 операций.')).toBeInTheDocument();
    });

    it('lets the user start a run while the undo stays available', () => {
        renderScreen({ summary: { legacyCount: 4, run: run('reverted'), undo: undoOf() } });
        expect(screen.getByRole('button', { name: 'Разобрать' })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Прошлая чистка' })).toBeInTheDocument();
    });
});
