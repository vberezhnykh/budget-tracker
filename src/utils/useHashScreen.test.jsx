import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useHashScreen, { navDirection } from './useHashScreen';

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

        it.each(['accounts', 'categories', 'trash', 'cleanup'])('reads #more/%s as the «Ещё» tab with that inner screen', (name) => {
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

        it('reads #analytics/ask as the «Аналитика» tab with the chat inside', () => {
            window.history.replaceState(null, '', '/#analytics/ask');
            const { result } = renderHook(() => useHashScreen());

            expect(result.current).toMatchObject({ screen: 'analytics', inner: 'ask' });
        });

        it('keeps inner screens under their own tab: ask is not under «Ещё», accounts are not under «Аналитика»', () => {
            window.history.replaceState(null, '', '/#more/ask');
            expect(renderHook(() => useHashScreen()).result.current).toMatchObject({ screen: 'more', inner: null });

            window.history.replaceState(null, '', '/#analytics/accounts');
            expect(renderHook(() => useHashScreen()).result.current).toMatchObject({ screen: 'analytics', inner: null });

            window.history.replaceState(null, '', '/#analytics/nonsense');
            expect(renderHook(() => useHashScreen()).result.current).toMatchObject({ screen: 'analytics', inner: null });
        });

        it('openInner(ask) pushes #analytics/ask from the Analytics tab and closeInner goes back to it', async () => {
            const { result } = renderHook(() => useHashScreen());
            act(() => result.current.setScreen('analytics'));
            const pushState = vi.spyOn(window.history, 'pushState');
            const back = vi.spyOn(window.history, 'back');

            act(() => result.current.openInner('ask'));
            expect(pushState).toHaveBeenCalledTimes(1);
            expect(window.location.hash).toBe('#analytics/ask');
            expect(window.history.state).toMatchObject({ budgetInnerPushed: true });
            expect(result.current).toMatchObject({ screen: 'analytics', inner: 'ask' });

            act(() => result.current.closeInner());
            expect(back).toHaveBeenCalledTimes(1);
            await waitFor(() => expect(result.current.inner).toBe(null));
            expect(result.current.screen).toBe('analytics');
            expect(window.location.hash).toBe('#analytics');
        });

        it('closeInner on a page opened straight on #analytics/ask replaces the hash with #analytics', () => {
            window.history.replaceState(null, '', '/#analytics/ask');
            const back = vi.spyOn(window.history, 'back');
            const { result } = renderHook(() => useHashScreen());

            act(() => result.current.closeInner());

            expect(back).not.toHaveBeenCalled();
            expect(window.location.hash).toBe('#analytics');
            expect(result.current).toMatchObject({ screen: 'analytics', inner: null });
        });

        it('a tab tap from the chat replaces the entry, and openInner(ask) twice pushes once', () => {
            const { result } = renderHook(() => useHashScreen());
            const pushState = vi.spyOn(window.history, 'pushState');
            act(() => result.current.openInner('ask'));
            act(() => result.current.openInner('ask'));
            expect(pushState).toHaveBeenCalledTimes(1);

            act(() => result.current.setScreen('history'));
            expect(result.current).toMatchObject({ screen: 'history', inner: null });
            expect(window.location.hash).toBe('#history');
            expect(pushState).toHaveBeenCalledTimes(1);
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
    describe('slide direction', () => {
        const TABS = ['overview', 'history', 'analytics', 'more'];

        it('is forward to a tab on the right and back to a tab on the left, for every pair of tabs', () => {
            TABS.forEach((from, i) => TABS.forEach((to, j) => {
                if (i === j) return;
                expect(navDirection(from, to), `${from} -> ${to}`).toBe(j > i ? 'forward' : 'back');
            }));
        });

        it('counts an inner screen as its own tab: opening goes forward, closing and the tab tap go back', () => {
            expect(navDirection('more', 'more/accounts')).toBe('forward');
            expect(navDirection('analytics', 'analytics/ask')).toBe('forward');
            expect(navDirection('overview', 'more/trash')).toBe('forward');
            expect(navDirection('more/accounts', 'more')).toBe('back');
            expect(navDirection('analytics/ask', 'analytics')).toBe('back');
        });

        it('compares tab ranks when leaving an inner screen through the bottom bar', () => {
            expect(navDirection('more/accounts', 'overview')).toBe('back');
            expect(navDirection('more/cleanup', 'analytics')).toBe('back');
            expect(navDirection('analytics/ask', 'more')).toBe('forward');
            expect(navDirection('analytics/ask', 'history')).toBe('back');
        });
    });

    describe('view transitions', () => {
        let startViewTransition;
        let finish;
        let reduceMotion;

        const popTo = (url) => act(() => {
            window.history.replaceState(null, '', url);
            window.dispatchEvent(new PopStateEvent('popstate'));
        });
        const direction = () => document.documentElement.dataset.navDirection;

        beforeEach(() => {
            reduceMotion = false;
            vi.stubGlobal('matchMedia', (query) => ({
                matches: reduceMotion && query.includes('prefers-reduced-motion'),
                media: query,
            }));
            // Заглушка браузера: колбэк обновления выполняется сразу, а
            // finished завершается, когда тест вызовет finish().
            startViewTransition = vi.fn((update) => {
                update();
                return { finished: new Promise((resolve) => { finish = resolve; }) };
            });
            document.startViewTransition = startViewTransition;
        });

        afterEach(() => {
            delete document.startViewTransition;
            delete document.documentElement.dataset.navDirection;
            vi.unstubAllGlobals();
        });

        it('animates a tab switch and sets the direction on <html> for the transition', () => {
            const { result } = renderHook(() => useHashScreen());
            let seen;
            startViewTransition.mockImplementation((update) => {
                seen = direction();
                update();
                return { finished: new Promise(() => { }) };
            });

            act(() => result.current.setScreen('history'));
            expect(startViewTransition).toHaveBeenCalledTimes(1);
            expect(seen).toBe('forward');
            expect(result.current.screen).toBe('history');

            act(() => result.current.setScreen('overview'));
            expect(startViewTransition).toHaveBeenCalledTimes(2);
            expect(seen).toBe('back');
            expect(result.current.screen).toBe('overview');
        });

        it('does not touch the route until the browser runs the update callback', () => {
            const { result } = renderHook(() => useHashScreen());
            let update;
            startViewTransition.mockImplementation((callback) => {
                update = callback;
                return { finished: new Promise(() => { }) };
            });

            act(() => result.current.setScreen('analytics'));
            expect(result.current.screen).toBe('overview');
            expect(window.location.hash).toBe('#analytics');

            act(() => update());
            expect(result.current.screen).toBe('analytics');
        });

        it('clears the direction once the transition has finished', async () => {
            const { result } = renderHook(() => useHashScreen());

            act(() => result.current.setScreen('history'));
            expect(direction()).toBe('forward');

            finish();
            await waitFor(() => expect(direction()).toBeUndefined());
        });

        it('does not let a skipped transition clear the direction of the one that replaced it', async () => {
            const { result } = renderHook(() => useHashScreen());
            const finishers = [];
            startViewTransition.mockImplementation((update) => {
                update();
                return { finished: new Promise((resolve) => finishers.push(resolve)) };
            });

            act(() => result.current.setScreen('analytics'));
            act(() => result.current.setScreen('overview'));
            expect(direction()).toBe('back');

            // Первый переход пропущен браузером и закончился позже второго
            // начала: направление второго остаётся до его собственного конца.
            finishers[0]();
            await Promise.resolve();
            await Promise.resolve();
            expect(direction()).toBe('back');

            finishers[1]();
            await waitFor(() => expect(direction()).toBeUndefined());
        });

        it('measures the second of two quick taps from the first one, not from the screen still on display', () => {
            const { result } = renderHook(() => useHashScreen());
            const updates = [];
            const seen = [];
            startViewTransition.mockImplementation((update) => {
                seen.push(direction());
                updates.push(update);
                return { finished: new Promise(() => { }) };
            });

            act(() => result.current.setScreen('analytics'));
            act(() => result.current.setScreen('history'));
            expect(seen).toEqual(['forward', 'back']);

            // Даже если колбэк пропущенного первого перехода выполнится позже
            // второго, экран остаётся тем, куда нажали последним.
            act(() => updates[1]());
            act(() => updates[0]());
            expect(result.current.screen).toBe('history');
        });

        it('opens an inner screen forward, and a tab tap from it goes by tab order', () => {
            const { result } = renderHook(() => useHashScreen());
            const seen = [];
            startViewTransition.mockImplementation((update) => {
                seen.push(direction());
                update();
                return { finished: new Promise(() => { }) };
            });

            act(() => result.current.openInner('accounts'));
            act(() => result.current.setScreen('more'));
            act(() => result.current.openInner('trash'));
            act(() => result.current.setScreen('history'));

            expect(seen).toEqual(['forward', 'back', 'forward', 'back']);
        });

        it('animates closeInner back through the popstate that history.back() brings', async () => {
            const { result } = renderHook(() => useHashScreen());
            act(() => result.current.openInner('categories'));
            startViewTransition.mockClear();
            let seen;
            startViewTransition.mockImplementation((update) => {
                seen = direction();
                update();
                return { finished: new Promise(() => { }) };
            });

            act(() => result.current.closeInner());
            await waitFor(() => expect(result.current.inner).toBe(null));

            expect(startViewTransition).toHaveBeenCalledTimes(1);
            expect(seen).toBe('back');
        });

        it('animates closeInner back when the page was opened on the inner screen (no history.back)', () => {
            window.history.replaceState(null, '', '/#more/categories');
            const { result } = renderHook(() => useHashScreen());
            let seen;
            startViewTransition.mockImplementation((update) => {
                seen = direction();
                update();
                return { finished: new Promise(() => { }) };
            });

            act(() => result.current.closeInner());

            expect(seen).toBe('back');
            expect(result.current).toMatchObject({ screen: 'more', inner: null });
        });

        it('does not animate a popstate that nobody asked for (the Safari swipe, history.back from elsewhere)', () => {
            const { result } = renderHook(() => useHashScreen());
            act(() => result.current.openInner('accounts'));
            startViewTransition.mockClear();

            popTo('/#more');

            expect(startViewTransition).not.toHaveBeenCalled();
            expect(result.current).toMatchObject({ screen: 'more', inner: null });
        });

        it('does not animate an edited hash (hashchange)', () => {
            const { result } = renderHook(() => useHashScreen());

            act(() => {
                window.history.replaceState(null, '', '/#history');
                window.dispatchEvent(new HashChangeEvent('hashchange'));
            });

            expect(startViewTransition).not.toHaveBeenCalled();
            expect(result.current.screen).toBe('history');
        });

        it('consumes the back request: a later outside popstate is not animated', async () => {
            const { result } = renderHook(() => useHashScreen());
            act(() => result.current.openInner('accounts'));
            act(() => result.current.closeInner());
            await waitFor(() => expect(result.current.inner).toBe(null));
            startViewTransition.mockClear();

            popTo('/#analytics');

            expect(startViewTransition).not.toHaveBeenCalled();
            expect(result.current.screen).toBe('analytics');
        });

        it('forgets the back request when no popstate comes', () => {
            vi.useFakeTimers();
            try {
                const { result } = renderHook(() => useHashScreen());
                act(() => result.current.openInner('accounts'));
                // history.back() в этом тесте ничего не делает, popstate не придёт.
                vi.spyOn(window.history, 'back').mockImplementation(() => { });
                startViewTransition.mockClear();

                act(() => result.current.closeInner());
                act(() => { vi.advanceTimersByTime(1500); });
                popTo('/#more');

                expect(startViewTransition).not.toHaveBeenCalled();
                expect(result.current.inner).toBe(null);
            } finally {
                vi.useRealTimers();
            }
        });

        it('switches at once without view transitions when the user asks for reduced motion', () => {
            reduceMotion = true;
            const { result } = renderHook(() => useHashScreen());

            act(() => result.current.setScreen('history'));
            act(() => result.current.openInner('accounts'));

            expect(startViewTransition).not.toHaveBeenCalled();
            expect(direction()).toBeUndefined();
            expect(result.current).toMatchObject({ screen: 'more', inner: 'accounts' });
        });

        it('does not start a transition when the route stays the same', () => {
            const { result } = renderHook(() => useHashScreen());

            act(() => result.current.setScreen('overview'));
            act(() => result.current.setScreen('history'));
            startViewTransition.mockClear();
            act(() => result.current.setScreen('history'));

            expect(startViewTransition).not.toHaveBeenCalled();
        });

        it('switches directly when the API is missing', () => {
            delete document.startViewTransition;
            const { result } = renderHook(() => useHashScreen());

            act(() => result.current.setScreen('history'));

            expect(result.current.screen).toBe('history');
            expect(direction()).toBeUndefined();
        });

        it('falls back to a direct update and leaves no direction when startViewTransition throws', () => {
            startViewTransition.mockImplementation(() => { throw new Error('boom'); });
            const { result } = renderHook(() => useHashScreen());

            act(() => result.current.setScreen('history'));

            expect(result.current.screen).toBe('history');
            expect(direction()).toBeUndefined();
        });

        it('removes the direction when the hook unmounts mid-transition', () => {
            const { result, unmount } = renderHook(() => useHashScreen());
            act(() => result.current.setScreen('history'));
            expect(direction()).toBe('forward');

            unmount();

            expect(direction()).toBeUndefined();
        });
    });
});
