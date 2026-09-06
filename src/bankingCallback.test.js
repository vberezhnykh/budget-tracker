// @vitest-environment node

import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const html = readFileSync(new URL('../public/banking/callback.html', import.meta.url), 'utf8');
const script = new Script(readFileSync(new URL('../public/banking/callback.js', import.meta.url), 'utf8'));
const baseUrl = 'https://budget.example/banking/callback.html';
const pages = [];

function openCallback(query = '', { clipboardAvailable = true, writeText = vi.fn().mockResolvedValue() } = {}) {
    // Outside-only runs the real callback script without fetching page assets.
    const dom = new JSDOM(html, { url: baseUrl + query, runScripts: 'outside-only' });
    const { window } = dom;
    const forbiddenCalls = {};
    for (const name of ['localStorage', 'sessionStorage']) {
        forbiddenCalls[name] = vi.fn(() => { throw new Error(`Unexpected ${name} access`); });
        Object.defineProperty(window, name, { configurable: true, get: forbiddenCalls[name] });
    }
    for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']) {
        forbiddenCalls[name] = vi.fn(() => { throw new Error(`Unexpected ${name} request`); });
        Object.defineProperty(window, name, { configurable: true, value: forbiddenCalls[name] });
    }
    forbiddenCalls.sendBeacon = vi.fn();
    Object.defineProperty(window.navigator, 'sendBeacon', { value: forbiddenCalls.sendBeacon });
    Object.defineProperty(window.navigator, 'clipboard', {
        value: clipboardAvailable ? { writeText } : undefined,
    });
    const page = {
        dom,
        forbiddenCalls,
        writeText,
        window,
        document: window.document,
        copy: window.document.getElementById('copy'),
        status: window.document.getElementById('status'),
        copyStatus: window.document.getElementById('copy-status'),
        instructions: window.document.getElementById('instructions'),
    };
    pages.push(page);
    script.runInContext(dom.getInternalVMContext());
    return page;
}

afterEach(() => {
    try {
        // Check every branch, including user clicks, for persistence or outbound requests.
        for (const page of pages) {
            for (const [name, spy] of Object.entries(page.forbiddenCalls)) {
                expect(spy, name).not.toHaveBeenCalled();
            }
        }
    } finally {
        for (const page of pages) page.dom.window.close();
        pages.length = 0;
    }
});

describe('Bank callback page', () => {
    it('removes the entire query and fragment from the current history entry', () => {
        const page = openCallback('?code=secret-code&state=secret-state&extra=private#private-fragment');

        expect(page.window.location.href).toBe(baseUrl);
        expect(page.window.history.length).toBe(1);
        expect(page.window.history.state).toBeNull();
        expect(page.document.body.textContent).not.toContain('secret-code');
        expect(page.document.body.textContent).not.toContain('secret-state');
        expect(page.document.body.textContent).not.toContain('private');
    });

    it.each([
        '',
        '?state=only-state',
        '?code=only-code',
        '?error=access_denied',
        '?unrelated=value',
        '#code=fragment-code&state=fragment-state',
    ])('does not offer copying an absent or incomplete response: %s', async (query) => {
        const page = openCallback(query);

        expect(page.copy.hidden).toBe(true);
        expect(page.instructions.hidden).toBe(true);
        expect(page.status.textContent).toContain('Ответ банка отсутствует');
        expect(page.window.location.href).toBe(baseUrl);
        page.copy.click();
        await Promise.resolve();
        expect(page.writeText).not.toHaveBeenCalled();
    });

    it('copies the exact original callback only after an explicit click', async () => {
        const query = '?code=a%2Bb%2Fc%3D&state=state%20with%20spaces&extra=1#fragment';
        const page = openCallback(query);

        expect(page.copy.hidden).toBe(false);
        expect(page.instructions.hidden).toBe(false);
        expect(page.status.textContent).toContain('Ответ банка получен');
        expect(page.writeText).not.toHaveBeenCalled();
        expect(page.copyStatus.textContent).toBe('');

        page.copy.click();
        await vi.waitFor(() => expect(page.copyStatus.textContent).toContain('Скопировано'));
        expect(page.writeText).toHaveBeenCalledExactlyOnceWith(baseUrl + query);
        expect(page.window.location.href).toBe(baseUrl);
    });

    it('shows a fixed error message without rendering provider-controlled strings or HTML', async () => {
        const providerError = '<img src="https://evil.example/collect" onerror="alert(1)">';
        const query = `?state=test-state&error=${encodeURIComponent(providerError)}&error_description=private-provider-message`;
        const page = openCallback(query);

        expect(page.status.textContent).toContain('Банк вернул отказ или ошибку');
        expect(page.document.body.textContent).not.toContain(providerError);
        expect(page.document.body.textContent).not.toContain('private-provider-message');
        expect(page.document.querySelector('img')).toBeNull();
        expect(page.copy.hidden).toBe(false);
        expect(page.writeText).not.toHaveBeenCalled();

        page.copy.click();
        await vi.waitFor(() => expect(page.copyStatus.textContent).toContain('Скопировано'));
        expect(page.writeText).toHaveBeenCalledExactlyOnceWith(baseUrl + query);
    });

    it('handles clipboard rejection and permits retrying without an unhandled rejection', async () => {
        const writeText = vi.fn()
            .mockRejectedValueOnce(new Error('private clipboard failure'))
            .mockResolvedValueOnce();
        const page = openCallback('?state=state&code=code', { writeText });
        const unhandled = vi.fn();
        page.window.addEventListener('unhandledrejection', unhandled);

        page.copy.click();
        await vi.waitFor(() => expect(page.copyStatus.textContent).toContain('Браузер не разрешил копирование'));
        expect(page.copyStatus.textContent).not.toContain('private clipboard failure');
        expect(unhandled).not.toHaveBeenCalled();

        page.copy.click();
        await vi.waitFor(() => expect(page.copyStatus.textContent).toContain('Скопировано'));
        expect(writeText).toHaveBeenCalledTimes(2);
        expect(unhandled).not.toHaveBeenCalled();
    });

    it('handles browsers without the clipboard API', async () => {
        const page = openCallback('?state=state&code=code', { clipboardAvailable: false });

        page.copy.click();
        await vi.waitFor(() => expect(page.copyStatus.textContent).toContain('Браузер не разрешил копирование'));
        expect(page.writeText).not.toHaveBeenCalled();
    });
});
