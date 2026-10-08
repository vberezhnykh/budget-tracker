import { act, renderHook } from '@testing-library/react';
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
        expect(renderHook(() => useHashScreen()).result.current[0]).toBe('overview');

        window.history.replaceState(null, '', '/#nonsense');
        expect(renderHook(() => useHashScreen()).result.current[0]).toBe('overview');
    });

    it.each(['history', 'analytics', 'more'])('reads the initial screen from #%s', (name) => {
        window.history.replaceState(null, '', `/#${name}`);
        const { result } = renderHook(() => useHashScreen());

        expect(result.current[0]).toBe(name);
    });

    it('writes the hash on a tab change, keeps path and query, and drops it for the overview', () => {
        window.history.replaceState(null, '', '/?banking=ok');
        const { result } = renderHook(() => useHashScreen());

        act(() => result.current[1]('history'));
        expect(result.current[0]).toBe('history');
        expect(window.location.hash).toBe('#history');
        expect(window.location.search).toBe('?banking=ok');

        act(() => result.current[1]('overview'));
        expect(result.current[0]).toBe('overview');
        expect(window.location.hash).toBe('');
        expect(window.location.search).toBe('?banking=ok');
    });

    it('does not add history entries when tabs are switched', () => {
        const pushState = vi.spyOn(window.history, 'pushState');
        const lengthBefore = window.history.length;
        const { result } = renderHook(() => useHashScreen());

        act(() => result.current[1]('history'));
        act(() => result.current[1]('analytics'));
        act(() => result.current[1]('more'));

        expect(pushState).not.toHaveBeenCalled();
        expect(window.history.length).toBe(lengthBefore);
    });

    it('follows a hash edited from outside through hashchange', () => {
        const { result } = renderHook(() => useHashScreen());

        act(() => {
            window.history.replaceState(null, '', '/#analytics');
            window.dispatchEvent(new HashChangeEvent('hashchange'));
        });
        expect(result.current[0]).toBe('analytics');

        act(() => {
            window.history.replaceState(null, '', '/');
            window.dispatchEvent(new HashChangeEvent('hashchange'));
        });
        expect(result.current[0]).toBe('overview');
    });

    it('scrolls the window to the top on a screen change, but not on mount or for the same screen', () => {
        const { result } = renderHook(() => useHashScreen());
        expect(window.scrollTo).not.toHaveBeenCalled();

        act(() => result.current[1]('more'));
        expect(window.scrollTo).toHaveBeenCalledTimes(1);
        expect(window.scrollTo).toHaveBeenCalledWith(0, 0);

        act(() => result.current[1]('more'));
        expect(window.scrollTo).toHaveBeenCalledTimes(1);

        act(() => {
            window.history.replaceState(null, '', '/#history');
            window.dispatchEvent(new HashChangeEvent('hashchange'));
        });
        expect(window.scrollTo).toHaveBeenCalledTimes(2);
    });

    it('stops listening to hashchange after unmount', () => {
        const remove = vi.spyOn(window, 'removeEventListener');
        const { unmount } = renderHook(() => useHashScreen());

        unmount();

        expect(remove).toHaveBeenCalledWith('hashchange', expect.any(Function));
    });
});
