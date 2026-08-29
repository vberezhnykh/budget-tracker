// Fixture data + API stubbing for the Playwright smoke suite. There is no
// backend here on purpose (see README) - every /api/** request is answered
// straight out of the browser via page.route(), mirroring the shapes the
// unit suite already uses in src/App.test.jsx. The app treats a 401 from
// any call as "log me out" (see apiFetch in src/App.jsx), so every route
// below must answer 200 or the app falls back to the login screen instead
// of the main UI.

// At least 4 accounts, per the task: the carousel needs enough slides to
// swipe through meaningfully. One name is deliberately long - long enough to
// wrap onto a second line at a 390px-wide viewport if the account row's
// flex item doesn't shrink (the minWidth: 0 defect), which is exactly what
// the "account rows stay on one line" test is trying to catch.
export const accounts = [
  { _id: 'acc-card-1', name: 'Тинькофф', type: 'card', icon: '💳', isDefault: true, order: 0 },
  { _id: 'acc-card-2', name: 'Сбербанк', type: 'card', icon: '💳', isDefault: false, order: 1 },
  { _id: 'acc-cash', name: 'Наличные', type: 'cash', icon: '💵', isDefault: true, order: 2 },
  { _id: 'acc-wallet', name: 'Кошелёк для крупных обязательных сбережений', type: 'cash', icon: '👛', isDefault: false, order: 3 },
];

export const categories = [
  { _id: 'cat-1', name: 'Еда', type: 'expense' },
  { _id: 'cat-2', name: 'Зарплата', type: 'income' },
];

export const transactions = [
  { _id: 'tx-1', title: 'Зарплата', amount: 3000, type: 'income', account: 'acc-card-1', date: '2026-01-01T00:00:00Z', category: 'Зарплата' },
  { _id: 'tx-2', title: 'Продукты', description: 'Продукты на неделю', amount: 120, type: 'expense', account: 'acc-card-1', date: '2026-01-05T00:00:00Z', category: 'Еда' },
  { _id: 'tx-3', title: 'Кофе', amount: 5, type: 'expense', account: 'acc-cash', date: '2026-01-06T00:00:00Z', category: 'Еда' },
  { _id: 'tx-4', title: 'Пополнение', amount: 500, type: 'income', account: 'acc-wallet', date: '2026-01-07T00:00:00Z', category: 'Зарплата' },
];

// Больше счетов, чем в основном наборе: ряд точек-индикаторов карусели при
// восьми счетах перестал помещаться в ширину телефона и переносился на
// вторую строку. Отдельный набор, а не расширение основного, - остальные
// тесты рассчитаны на четыре счёта и их геометрию.
export const manyAccounts = [
  ...accounts,
  { _id: 'acc-extra-1', name: 'Revolut', type: 'card', icon: '💳', isDefault: false, order: 4 },
  { _id: 'acc-extra-2', name: 'Wise', type: 'card', icon: '💳', isDefault: false, order: 5 },
  { _id: 'acc-extra-3', name: 'Обмен', type: 'cash', icon: '💱', isDefault: false, order: 6 },
  { _id: 'acc-extra-4', name: 'Копилка', type: 'cash', icon: '🐷', isDefault: false, order: 7 },
];

// Installs a single catch-all route for every /api/** call. GETs for the
// three endpoints App.jsx fetches on load return the fixtures above (or the
// per-test overrides passed in); every other /api/** call (writes, logout,
// anything else) gets a generic 200 so nothing the app does mid-test can
// hang waiting on a real server.
export async function mockApi(page, overrides = {}) {
  const accountsData = overrides.accounts || accounts;
  const transactionsData = overrides.transactions || transactions;
  const categoriesData = overrides.categories || categories;
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();

    if (method === 'GET' && pathname === '/api/accounts') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(accountsData) });
    }
    if (method === 'GET' && pathname === '/api/transactions') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(transactionsData) });
    }
    if (method === 'GET' && pathname === '/api/categories') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(categoriesData) });
    }

    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}
