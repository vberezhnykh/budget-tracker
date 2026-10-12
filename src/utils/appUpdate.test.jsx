import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentBuildVersion, useAppUpdate } from './appUpdate';

const CURRENT = '/assets/index-OLD.js';
const NEWER = '/assets/index-NEW.js';

describe('currentBuildVersion', () => {
  it('возвращает адрес входного модуля страницы', () => {
    const doc = new DOMParser().parseFromString(
      '<head><script type="module" crossorigin src="/assets/index-C07hSNy2.js"></script></head>',
      'text/html'
    );

    expect(currentBuildVersion(doc)).toBe('/assets/index-C07hSNy2.js');
  });

  it('отбрасывает происхождение и параметры адреса', () => {
    const doc = new DOMParser().parseFromString(
      '<head><script type="module" src="https://example.test/assets/index-A1.js?v=2"></script></head>',
      'text/html'
    );

    expect(currentBuildVersion(doc)).toBe('/assets/index-A1.js');
  });

  it('в разработке (модуль из /src) и без скриптов даёт null', () => {
    const dev = new DOMParser().parseFromString('<head><script type="module" src="/src/main.jsx"></script></head>', 'text/html');
    const empty = new DOMParser().parseFromString('<head></head>', 'text/html');

    expect(currentBuildVersion(dev)).toBeNull();
    expect(currentBuildVersion(empty)).toBeNull();
  });

  it('не принимает обычный (не module) скрипт из /assets', () => {
    const doc = new DOMParser().parseFromString('<head><script src="/assets/legacy.js"></script></head>', 'text/html');

    expect(currentBuildVersion(doc)).toBeNull();
  });
});

describe('useAppUpdate', () => {
  let script;
  let clock;
  let fetchImpl;

  const response = (version, extra = {}) => Promise.resolve({ ok: true, json: () => Promise.resolve({ version }), ...extra });
  const setVisibility = (state) => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  const setOnline = (value) => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value });
  const comeBack = () => act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const render = (options = {}) => renderHook(() => useAppUpdate({ fetchImpl, now: () => clock, ...options }));

  beforeEach(() => {
    script = document.createElement('script');
    script.type = 'module';
    script.src = CURRENT;
    document.head.appendChild(script);
    clock = 1_000_000;
    fetchImpl = vi.fn(() => response(NEWER));
    setVisibility('visible');
    setOnline(true);
  });

  afterEach(() => {
    script.remove();
    delete document.visibilityState;
    delete navigator.onLine;
  });

  it('не проверяет при монтировании', () => {
    const { result } = render();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.current.updateAvailable).toBe(false);
  });

  it('при возвращении в видимое состояние спрашивает версию без кеша и замечает новую', async () => {
    const { result } = render();

    await comeBack();

    expect(fetchImpl).toHaveBeenCalledWith('/api/version', { cache: 'no-store' });
    expect(result.current.updateAvailable).toBe(true);
  });

  it('уход в фон проверку не запускает', async () => {
    setVisibility('hidden');
    const { result } = render();

    await comeBack();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.current.updateAvailable).toBe(false);
  });

  it('pageshow из bfcache проверяет, обычный pageshow - нет', async () => {
    const { result } = render();
    const pageShow = (persisted) => act(async () => {
      const event = new Event('pageshow');
      event.persisted = persisted;
      window.dispatchEvent(event);
    });

    await pageShow(false);
    expect(fetchImpl).not.toHaveBeenCalled();

    await pageShow(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.current.updateAvailable).toBe(true);
  });

  it('не чаще раза в минуту', async () => {
    fetchImpl.mockImplementation(() => response(CURRENT));
    render();

    await comeBack();
    clock += 59_999;
    await comeBack();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    clock += 1;
    await comeBack();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('учитывает свой интервал', async () => {
    fetchImpl.mockImplementation(() => response(CURRENT));
    render({ minIntervalMs: 5_000 });

    await comeBack();
    clock += 5_000;
    await comeBack();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('офлайн не ходит на сервер и не расходует интервал', async () => {
    setOnline(false);
    const { result } = render();

    await comeBack();
    expect(fetchImpl).not.toHaveBeenCalled();

    setOnline(true);
    await comeBack();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.current.updateAvailable).toBe(true);
  });

  it.each([
    ['версии равны', CURRENT],
    ['сервер не знает версии (null)', null],
    ['версия пустая', ''],
    ['версия не строка', 42],
    ['поля version нет', undefined],
  ])('обновление не объявляется, если %s', async (_name, version) => {
    fetchImpl.mockImplementation(() => response(version));
    const { result } = render();

    await comeBack();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.current.updateAvailable).toBe(false);
  });

  it('у страницы без своей версии (разработка) не ходит на сервер никогда', async () => {
    script.remove();
    const dev = document.createElement('script');
    dev.type = 'module';
    dev.src = '/src/main.jsx';
    document.head.appendChild(dev);
    try {
      const { result } = render();

      await comeBack();

      expect(fetchImpl).not.toHaveBeenCalled();
      expect(result.current.updateAvailable).toBe(false);
    } finally {
      dev.remove();
    }
  });

  it('молча переживает ошибку сети, HTTP-ошибку и ответ не в JSON, и пробует снова', async () => {
    fetchImpl
      .mockImplementationOnce(() => Promise.reject(new Error('offline')))
      .mockImplementationOnce(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ version: NEWER }) }))
      .mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError('bad json')) }))
      .mockImplementation(() => response(NEWER));
    const { result } = render();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await comeBack();
      clock += 60_000;
      expect(result.current.updateAvailable).toBe(false);
    }

    await comeBack();
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(result.current.updateAvailable).toBe(true);
  });

  it('после размонтирования слушатели сняты', async () => {
    const { unmount } = render();
    unmount();

    await comeBack();

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
