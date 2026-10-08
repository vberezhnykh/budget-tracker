import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useHashScreen from './useHashScreen';

describe('useHashScreen', () => {
    beforeEach(() => {
        window.history.replaceState(null, '', '/');
        vi.spyOn(window, 'scrollTo').mockImplementation(() => { });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        window.history.replaceState(null, '', '/');
    });

    it('opens the overview when the hash is empty or unknown', () => {
        expect(renderHook(() => useHashScreen()).result.current.screen).toBe('overview');

        window.history.replaceState(null, '', '/#nonsense');
        expect(renderHook(() => useHashScreen()).result.current.screen).toBe('overview');
    });

    it.each(['history', 'analytics', 'more'])('reads the initial screen from #%s', (name) => {
        window.history.replaceState(null, '', `/#${name}`);
        const { result } = renderHook(() => useHashScreen());

        expect(result.current.screen).toBe(name);
    });

    it('writes the hash on a tab change, keeps path and query, and drops it for the overview', () => {
        window.history.replaceState(null, '', '/?banking=ok');
        const { result } = renderHook(() => useHashScreen());

        act(() => result.current.setScreen('history'));
        expect(result.current.screen).toBe('history');
        expect(window.location.hash).toBe('#history');
        expect(window.location.search).toBe('?banking=ok');

        act(() => result.current.setScreen('overview'));
        expect(result.current.screen).toBe('overview');
        expect(window.location.hash).toBe('');
        expect(window.location.search).toBe('?banking=ok');
    });

    it('does not add history entries when tabs are switched', () => {
        const pushState = vi.spyOn(window.history, 'pushState');
        const lengthBefore = window.history.length;
        const { result } = renderHook(() => useHashScreen());

        act(() => result.current.setScreen('history'));
        act(() => result.current.setScreen('analytics'));
        act(() => result.current.setScreen('more'));

        expect(pushState).not.toHaveBeenCalled();
        expect(window.history.length).toBe(lengthBefore);
    });

    it('follows a hash edited from outside through hashchange', () => {
        const { result } = renderHook(() => useHashScreen());

        act(() => {
            window.history.replaceState(null, '', '/#analytics');
            window.dispatchEvent(new HashChangeEvent('hashchange'));
        });
        expect(result.current.screen).toBe('analytics');

        act(() => {
            window.history.replaceState(null, '', '/');
            window.dispatchEvent(new HashChangeEvent('hashchange'));
        });
        expect(result.current.screen).toBe('overview');
    });

    it('scrolls the window to the top on a screen change, but not on mount or for the same screen', () => {
        const { result } = renderHook(() => useHashScreen());
        expect(window.scrollTo).not.toHaveBeenCalled();

        act(() => result.current.setScreen('more'));
        expect(window.scrollTo).toHaveBeenCalledTimes(1);
        expect(window.scrollTo).toHaveBeenCalledWith(0, 0);

        act(() => result.current.setScreen('more'));
        expect(window.scrollTo).toHaveBeenCalledTimes(1);

        act(() => {
            window.history.replaceState(null, '', '/#history');
            window.dispatchEvent(new HashChangeEvent('hashchange'));
        });
        expect(window.scrollTo).toHaveBeenCalledTimes(2);
    });

    it('stops listening to hashchange and popstate after unmount', () => {
        const remove = vi.spyOn(window, 'removeEventListener');
        const { unmount } = renderHook(() => useHashScreen());

        unmount();

        expect(remove).toHaveBeenCalledWith('hashchange', expect.any(Function));
        expect(remove).toHaveBeenCalledWith('popstate', expect.any(Function));
    });

    describe('inner screens', () => {
        const popTo = (url) => act(() => {
            window.history.replaceState(null, '', url);
            window.dispatchEvent(new PopStateEvent('popstate'));
        });

        it.each(['accounts', 'categories', 'trash'])('reads #more/%s as the «Ещё» tab with that inner screen', (name) => {
            window.history.replaceState(null, '', `/#more/${name}`);
            const { result } = renderHook(() => useHashScreen());

            expect(result.current.screen).toBe('more');
            expect(result.current.inner).toBe(name);
        });

        it('treats an unknown inner name as plain «Ещё» and inner hashes of other tabs as those tabs', () => {
            window.history.replaceState(null, '', '/#more/nonsense');
            const first = renderHook(() => useHashScreen());
            expect(first.result.current).toMatchObject({ screen: 'more', inner: null });

            window.history.replaceState(null, '', '/#history/accounts');
            const second = renderHook(() => useHashScreen());
            expect(second.result.current).toMatchObject({ screen: 'history', inner: null });
        });

        it('openInner pushes a history entry marked as pushed by the app and keeps path and query', () => {
            window.history.replaceState(null, '', '/?banking=ok');
            const pushState = vi.spyOn(window.history, 'pushState');
            const lengthBefore = window.history.length;
            const { result } = renderHook(() => useHashScreen());

            act(() => result.current.openInner('accounts'));

            expect(pushState).toHaveBeenCalledTimes(1);
            expect(window.history.length).toBe(lengthBefore + 1);
            expect(window.location.hash).toBe('#more/accounts');
            expect(window.location.search).toBe('?banking=ok');
            expect(window.history.state).toMatchObject({ budgetInnerPushed: true });
            expect(result.current).toMatchObject({ screen: 'more', inner: 'accounts' });
        });

        it('openInner ignores unknown names and the screen that is already open', () => {
            const pushState = vi.spyOn(window.history, 'pushState');
            const { result } = renderHook(() => useHashScreen());

            act(() => result.current.openInner('nonsense'));
            expect(pushState).not.toHaveBeenCalled();

            act(() => result.current.openInner('trash'));
            act(() => result.current.openInner('trash'));
            expect(pushState).toHaveBeenCalledTimes(1);
        });

        it('closeInner goes back through history when the entry was pushed by the app', async () => {
            const { result } = renderHook(() => useHashScreen());
            const back = vi.spyOn(window.history, 'back');

            act(() => result.current.openInner('categories'));
            act(() => result.current.closeInner());

            expect(back).toHaveBeenCalledTimes(1);
            // history.back() в jsdom асинхронен: состояние обновит popstate.
            await waitFor(() => expect(result.current.inner).toBe(null));
            expect(result.current.screen).toBe('overview');
            expect(window.location.hash).toBe('');
        });

        it('the system Back (popstate) closes an inner screen', () => {
            const { result } = renderHook(() => useHashScreen());
            act(() => result.current.setScreen('more'));
            act(() => result.current.openInner('accounts'));

            popTo('/#more');

            expect(result.current).toMatchObject({ screen: 'more', inner: null });
        });

        it('closeInner replaces the hash with #more when the page was opened on the inner screen', () => {
            window.history.replaceState(null, '', '/#more/categories');
            const back = vi.spyOn(window.history, 'back');
            const pushState = vi.spyOn(window.history, 'pushState');
            const lengthBefore = window.history.length;
            const { result } = renderHook(() => useHashScreen());

            act(() => result.current.closeInner());

            expect(back).not.toHaveBeenCalled();
            expect(pushState).not.toHaveBeenCalled();
            expect(window.history.length).toBe(lengthBefore);
            expect(window.location.hash).toBe('#more');
            expect(result.current).toMatchObject({ screen: 'more', inner: null });
        });

        it('forgets the pushed mark on a reload, so closeInner replaces instead of leaving the page', () => {
            window.history.replaceState({ budgetInnerPushed: true }, '', '/#more/trash');
            const back = vi.spyOn(window.history, 'back');
            const { result } = renderHook(() => useHashScreen());

            act(() => result.current.closeInner());

            expect(back).not.toHaveBeenCalled();
            expect(window.location.hash).toBe('#more');
        });

        it('a tab tap from an inner screen replaces the entry with that tab', () => {
            const { result } = renderHook(() => useHashScreen());
            act(() => result.current.openInner('accounts'));
            const pushState = vi.spyOn(window.history, 'pushState');

            act(() => result.current.setScreen('more'));
            expect(result.current).toMatchObject({ screen: 'more', inner: null });
            expect(window.location.hash).toBe('#more');

            act(() => result.current.openInner('trash'));
            pushState.mockClear();
            act(() => result.current.setScreen('history'));
            expect(result.current).toMatchObject({ screen: 'history', inner: null });
            expect(window.location.hash).toBe('#history');
            expect(pushState).not.toHaveBeenCalled();
        });

        it('scrolls to the top when an inner screen opens and when it closes', () => {
            const { result } = renderHook(() => useHashScreen());
            act(() => result.current.setScreen('more'));
            window.scrollTo.mockClear();

            act(() => result.current.openInner('accounts'));
            expect(window.scrollTo).toHaveBeenCalledTimes(1);

            popTo('/#more');
            expect(window.scrollTo).toHaveBeenCalledTimes(2);
            expect(window.scrollTo).toHaveBeenLastCalledWith(0, 0);
        });
    });
});
