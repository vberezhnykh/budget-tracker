// Тестовые подмены fetch отвечают на отдельные адреса: счета, категории,
// настройки, сводку. Приложение же запускается одним запросом /api/bootstrap.
// Чтобы не переписывать каждый мок, withBootstrap достраивает этот ответ из
// ответов самого мока на «старые» адреса - так же, как сервер собирает его из
// тех же данных (server/app.js). Ошибка любой части (сбой сети, не-2xx)
// становится ошибкой всего запроса, как и у сервера.
//
// Сами запросы к частям в журнал вызовов vi.fn не попадают (мок вызывается
// без обертки), поэтому в журнале видно ровно то, что приложение отправило.

const bootstrapPath = url => typeof url === 'string' && /^\/api\/bootstrap(\?|$)/.test(url);

async function composeBootstrap(impl, url) {
  const query = url.includes('?') ? url.slice(url.indexOf('?')) : '';
  const [accounts, categories, settings, dashboard] = await Promise.all([
    '/api/accounts',
    '/api/categories',
    '/api/settings',
    `/api/stats/dashboard${query}`,
  ].map(path => Promise.resolve(impl(path))));

  // Настройки, которых нет (404 у старого мока), - это settings: null.
  const parts = { accounts, categories, settings, dashboard };
  for (const [name, response] of Object.entries(parts)) {
    if (name === 'settings' && response.status === 404) continue;
    if (!response.ok) return response;
  }
  const body = {
    accounts: await accounts.json(),
    categories: await categories.json(),
    settings: settings.status === 404 ? null : await settings.json(),
    dashboard: await dashboard.json(),
  };
  return { ok: true, status: 200, json: async () => body };
}

// Оборачивает реализацию fetch: /api/bootstrap собирается из ответов impl.
export function withBootstrap(impl) {
  return (url, options) => (bootstrapPath(url) && !options?.method
    ? composeBootstrap(impl, url)
    : impl(url, options));
}

// Делает уже созданный vi.fn «понимающим» /api/bootstrap и для реализаций,
// которые тесты подставляют позже через mockImplementation(Once).
function bootstrapAware(mock) {
  const set = mock.mockImplementation.bind(mock);
  const setOnce = mock.mockImplementationOnce.bind(mock);
  mock.mockImplementation = impl => set(withBootstrap(impl));
  mock.mockImplementationOnce = impl => setOnce(withBootstrap(impl));
  return mock;
}

// fetch-мок, который понимает /api/bootstrap: и с исходной реализацией, и с
// теми, что тест подставит позже.
export function bootstrapFetch(vi, impl) {
  return bootstrapAware(vi.fn(withBootstrap(impl)));
}

// Чтения сводки в журнале вызовов fetch-мока. Стартовый снимок (/api/bootstrap)
// просит сводку сразу с analytics=1, поэтому отдельные запросы к
// /api/stats/dashboard - это только смена выбора и фоновая подгрузка Аналитики.
const urlsOf = calls => calls.map(([url]) => url).filter(url => typeof url === 'string');

export const bootstrapCalls = calls => urlsOf(calls).filter(url => url.startsWith('/api/bootstrap?'));
export const dashboardCalls = calls => urlsOf(calls).filter(url => url.startsWith('/api/stats/dashboard?'));
export const analyticsDashboardCalls = calls => dashboardCalls(calls).filter(url => url.includes('analytics=1'));
