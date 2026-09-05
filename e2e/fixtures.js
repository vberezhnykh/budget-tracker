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

export const plannedPayments = [
  { _id: 'plan-overdue', __v: 0, title: 'Интернет', amount: 35, dueDate: '2026-09-01T00:00:00.000Z', account: 'acc-card-1', category: 'Еда', description: 'Домашний тариф', status: 'pending' },
  { _id: 'plan-upcoming', __v: 0, title: 'Аренда квартиры', amount: 850, dueDate: '2026-09-20T00:00:00.000Z', account: 'acc-card-2', category: 'Еда', description: '', status: 'pending' },
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
// four endpoints App.jsx fetches on load return the fixtures above (or the
// per-test overrides passed in); every other /api/** call (writes, logout,
// anything else) gets a generic 200 so nothing the app does mid-test can
// hang waiting on a real server.
export async function mockApi(page, overrides = {}) {
  const accountsData = overrides.accounts || accounts;
  const transactionsData = overrides.transactions || transactions;
  const categoriesData = overrides.categories || categories;
  const settingsData = overrides.settings || { monthlyLimit: 7000 };
  const plannedPaymentsData = overrides.plannedPayments || plannedPayments;
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
    if (method === 'GET' && pathname === '/api/settings') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(settingsData) });
    }
    if (method === 'GET' && pathname === '/api/planned-payments') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(plannedPaymentsData) });
    }
    if (method === 'GET' && pathname === '/api/trash') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(overrides.trash || []) });
    }

    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

export async function mockPhase2Api(page, overrides = {}) {
  const state = {
    accounts: structuredClone(overrides.accounts || accounts),
    categories: structuredClone(overrides.categories || categories),
    transactions: structuredClone(overrides.transactions || transactions),
    plannedPayments: structuredClone(overrides.plannedPayments || plannedPayments),
    trash: structuredClone(overrides.trash || []),
  };
  const fulfill = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/api/**', (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    const input = request.postData() ? request.postDataJSON() : {};

    if (method === 'GET' && pathname === '/api/accounts') return fulfill(route, state.accounts);
    if (method === 'GET' && pathname === '/api/transactions') return fulfill(route, state.transactions);
    if (method === 'GET' && pathname === '/api/categories') return fulfill(route, state.categories);
    if (method === 'GET' && pathname === '/api/settings') return fulfill(route, { monthlyLimit: 7000 });
    if (method === 'GET' && pathname === '/api/planned-payments') return fulfill(route, state.plannedPayments);
    if (method === 'GET' && pathname === '/api/trash') return fulfill(route, state.trash);

    if (method === 'POST' && pathname === '/api/planned-payments') {
      const saved = { _id: `plan-${state.plannedPayments.length + 1}`, __v: 0, status: 'pending', ...input, dueDate: `${input.dueDate}T00:00:00.000Z` };
      state.plannedPayments.push(saved);
      return fulfill(route, saved, 201);
    }

    const payMatch = pathname.match(/^\/api\/planned-payments\/([^/]+)\/pay$/);
    if (method === 'POST' && payMatch) {
      const payment = state.plannedPayments.find(item => item._id === payMatch[1]);
      const transaction = input.transactionId
        ? state.transactions.find(item => item._id === input.transactionId)
        : {
          _id: `paid-${payment._id}`,
          __v: 0,
          title: payment.title,
          description: payment.description,
          amount: input.amount,
          type: 'expense',
          account: input.account,
          category: input.category,
          date: `${input.date}T00:00:00.000Z`,
        };
      if (!input.transactionId) state.transactions.push(transaction);
      Object.assign(payment, {
        __v: payment.__v + 1,
        status: 'paid',
        transactionId: transaction._id,
        paidAt: transaction.date,
        transactionSummary: { amount: transaction.amount, date: transaction.date, account: transaction.account, category: transaction.category },
      });
      return fulfill(route, { payment, transaction, replayed: false });
    }

    const transactionMatch = pathname.match(/^\/api\/transactions\/([^/]+)$/);
    if (method === 'DELETE' && transactionMatch) {
      const index = state.transactions.findIndex(item => item._id === transactionMatch[1]);
      const [transaction] = state.transactions.splice(index, 1);
      const group = { id: transaction._id, deletionBatchId: `batch-${transaction._id}`, deletedAt: new Date().toISOString(), count: 1, transactions: [transaction] };
      state.trash.push(group);
      state.plannedPayments.forEach(payment => {
        if (payment.transactionId === transaction._id) payment.transactionDeleted = true;
      });
      return fulfill(route, { trashId: transaction._id, count: 1 });
    }

    const restoreMatch = pathname.match(/^\/api\/trash\/([^/]+)\/restore$/);
    if (method === 'POST' && restoreMatch) {
      const index = state.trash.findIndex(group => group.id === restoreMatch[1]);
      const [group] = state.trash.splice(index, 1);
      state.transactions.push(...group.transactions);
      state.plannedPayments.forEach(payment => {
        if (group.transactions.some(transaction => transaction._id === payment.transactionId)) payment.transactionDeleted = false;
      });
      return fulfill(route, { count: group.count });
    }

    const purgeMatch = pathname.match(/^\/api\/trash\/([^/]+)$/);
    if (method === 'DELETE' && purgeMatch) {
      const index = state.trash.findIndex(group => group.id === purgeMatch[1]);
      const [group] = state.trash.splice(index, 1);
      state.plannedPayments.forEach(payment => {
        if (group.transactions.some(transaction => transaction._id === payment.transactionId)) {
          Object.assign(payment, { status: 'pending', transactionId: undefined, paidAt: undefined, transactionDeleted: false, transactionSummary: undefined, __v: payment.__v + 1 });
        }
      });
      return fulfill(route, { count: group.count });
    }

    return fulfill(route, {});
  });

  return state;
}
