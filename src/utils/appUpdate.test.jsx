import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentBuildVersion, useAppUpdate, applyUpdate, refreshShell } from './appUpdate';
import { flushIdle } from '../test/idle';

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

  it('при монтировании сразу не ходит за версией: проверка ждет простоя', async () => {
    const { result } = render();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.current.updateAvailable).toBe(false);

    await flushIdle();

    expect(fetchImpl).toHaveBeenCalledWith('/api/version', { cache: 'no-store' });
  });

  describe('проверка при запуске', () => {
    it('замечает новую версию и называет ее', async () => {
      const { result } = render();

      await flushIdle();

      expect(result.current.updateAvailable).toBe(true);
      expect(result.current.targetVersion).toBe(NEWER);
    });

    it('при той же версии ничего не объявляет', async () => {
      fetchImpl.mockImplementation(() => response(CURRENT));
      const { result } = render();

      await flushIdle();

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(result.current.updateAvailable).toBe(false);
      expect(result.current.targetVersion).toBeNull();
    });

    it('ждет, пока данные не окажутся на экране (ready), и только потом ставит проверку в простой', async () => {
      const { rerender } = renderHook((props) => useAppUpdate({ fetchImpl, now: () => clock, ...props }), {
        initialProps: { ready: false },
      });

      await flushIdle();
      expect(fetchImpl).not.toHaveBeenCalled();

      rerender({ ready: true });
      await flushIdle();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('не входит в минутный интервал: возврат из фона сразу после запуска тоже спрашивает версию', async () => {
      fetchImpl.mockImplementation(() => response(CURRENT));
      render();

      await flushIdle();
      await comeBack();

      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('размонтирование до простоя отменяет проверку', async () => {
      const { unmount } = render();
      unmount();

      await flushIdle();

      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('офлайн молчит', async () => {
      setOnline(false);
      const { result } = render();

      await flushIdle();

      expect(fetchImpl).not.toHaveBeenCalled();
      expect(result.current.updateAvailable).toBe(false);
    });

    it('в разработке (нет своей версии) в простое не ходит на сервер', async () => {
      script.remove();
      const dev = document.createElement('script');
      dev.type = 'module';
      dev.src = '/src/main.jsx';
      document.head.appendChild(dev);
      try {
        render();

        await flushIdle();

        expect(fetchImpl).not.toHaveBeenCalled();
      } finally {
        dev.remove();
      }
    });
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

// Воркер, управляющий страницей: принимает сообщение с портом и отвечает по
// нему, как public/sw.js.
function fakeWorker({ reply = { type: 'shell-refreshed', ok: true }, answer = true } = {}) {
  const worker = {
    messages: [],
    postMessage: vi.fn((message, ports) => {
      worker.messages.push(message);
      if (answer) setTimeout(() => ports[0].postMessage(reply), 0);
    }),
  };
  return { controller: worker, worker };
}

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    data,
  };
}

const KEY = 'budgetpro-reloaded-for';

describe('refreshShell', () => {
  it('без воркера, управляющего страницей, сразу завершается без сообщений', async () => {
    await expect(refreshShell({ serviceWorker: { controller: null } })).resolves.toBe(false);
    await expect(refreshShell({ serviceWorker: undefined })).resolves.toBe(false);
  });

  it('посылает refresh-shell с портом для ответа и завершается после ответа воркера', async () => {
    const { controller, worker } = fakeWorker();

    const result = await refreshShell({ serviceWorker: { controller } });

    expect(result).toBe(true);
    expect(worker.messages).toEqual([{ type: 'refresh-shell' }]);
    expect(worker.postMessage.mock.calls[0][1]).toHaveLength(1);
  });

  it('ответ воркера об ошибке дает false, но тоже завершается', async () => {
    const { controller } = fakeWorker({ reply: { type: 'shell-refreshed', ok: false } });

    await expect(refreshShell({ serviceWorker: { controller } })).resolves.toBe(false);
  });

  it('не ждет молчащего воркера дольше таймаута', async () => {
    vi.useFakeTimers();
    try {
      const { controller } = fakeWorker({ answer: false });
      const pending = refreshShell({ serviceWorker: { controller }, timeoutMs: 4000 });

      await vi.advanceTimersByTimeAsync(3999);
      let settled = false;
      pending.then(() => { settled = true; });
      await Promise.resolve();
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('сбой postMessage не ломает завершение', async () => {
    const controller = { postMessage: () => { throw new Error('dead worker'); } };

    await expect(refreshShell({ serviceWorker: { controller } })).resolves.toBe(false);
  });
});

describe('applyUpdate', () => {
  it('без воркера перезагружает сразу и синхронно', () => {
    const reload = vi.fn();
    const storage = memoryStorage();

    const started = applyUpdate(NEWER, { reload, storage, serviceWorker: { controller: null } });

    expect(started).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.data.get(KEY)).toBe(NEWER);
  });

  it('с воркером сначала просит обновить оболочку и перезагружается только после ответа', async () => {
    const reload = vi.fn();
    const storage = memoryStorage();
    const { controller, worker } = fakeWorker();

    const started = applyUpdate(NEWER, { reload, storage, serviceWorker: { controller } });

    expect(started).toBe(true);
    expect(worker.messages).toEqual([{ type: 'refresh-shell' }]);
    expect(reload).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('перезагружается и когда воркер ответил ошибкой: ждать больше нечего', async () => {
    const reload = vi.fn();
    const { controller } = fakeWorker({ reply: { type: 'shell-refreshed', ok: false } });

    applyUpdate(NEWER, { reload, storage: memoryStorage(), serviceWorker: { controller } });

    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('перезагружается по таймауту, если воркер молчит', async () => {
    vi.useFakeTimers();
    try {
      const reload = vi.fn();
      const { controller } = fakeWorker({ answer: false });
      applyUpdate(NEWER, { reload, storage: memoryStorage(), serviceWorker: { controller }, timeoutMs: 1000 });

      await vi.advanceTimersByTimeAsync(999);
      expect(reload).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('на одну версию автоматически перезагружается не больше одного раза за сеанс вкладки', () => {
    const reload = vi.fn();
    const storage = memoryStorage();
    const options = { reload, storage, serviceWorker: { controller: null } };

    expect(applyUpdate(NEWER, options)).toBe(true);
    // Страница вернулась все еще старой и снова видит ту же новую версию.
    expect(applyUpdate(NEWER, options)).toBe(false);
    expect(applyUpdate(NEWER, options)).toBe(false);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('другая новая версия снова разрешает одну перезагрузку', () => {
    const reload = vi.fn();
    const storage = memoryStorage({ [KEY]: NEWER });
    const options = { reload, storage, serviceWorker: { controller: null } };

    expect(applyUpdate(NEWER, options)).toBe(false);
    expect(applyUpdate('/assets/index-NEWEST.js', options)).toBe(true);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.data.get(KEY)).toBe('/assets/index-NEWEST.js');
  });

  it('нажатие «Обновить» (force) защитой не останавливается', () => {
    const reload = vi.fn();
    const storage = memoryStorage({ [KEY]: NEWER });

    expect(applyUpdate(NEWER, { force: true, reload, storage, serviceWorker: { controller: null } })).toBe(true);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('если хранилище не читается или не пишется, автоматически не перезагружает (петлю не исключить), а по нажатию - да', () => {
    const reload = vi.fn();
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const readOnly = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    const worker = { controller: null };

    expect(applyUpdate(NEWER, { reload, storage: throwing, serviceWorker: worker })).toBe(false);
    expect(applyUpdate(NEWER, { reload, storage: readOnly, serviceWorker: worker })).toBe(false);
    expect(applyUpdate(NEWER, { reload, storage: null, serviceWorker: worker })).toBe(false);
    expect(reload).not.toHaveBeenCalled();

    expect(applyUpdate(NEWER, { force: true, reload, storage: throwing, serviceWorker: worker })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('если сам доступ к sessionStorage бросает исключение, автоматически не перезагружает и не падает', () => {
    const reload = vi.fn();
    const spy = vi.spyOn(globalThis, 'sessionStorage', 'get').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
    try {
      expect(applyUpdate(NEWER, { reload, serviceWorker: { controller: null } })).toBe(false);
      expect(applyUpdate(NEWER, { force: true, reload, serviceWorker: { controller: null } })).toBe(true);
    } finally {
      spy.mockRestore();
    }
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('без названия версии автоматически не перезагружает', () => {
    const reload = vi.fn();

    expect(applyUpdate(null, { reload, storage: memoryStorage(), serviceWorker: { controller: null } })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('в хранилище попадает только строка с адресом сборки', () => {
    const storage = memoryStorage();

    applyUpdate(NEWER, { reload: vi.fn(), storage, serviceWorker: { controller: null } });

    expect([...storage.data.entries()]).toEqual([[KEY, NEWER]]);
  });
});
