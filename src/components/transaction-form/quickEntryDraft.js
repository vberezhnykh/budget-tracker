// Черновик от «Ввода фразой» поверх данных формы. Чистая функция: форма
// передаёт её слепок и список счетов, а получает новые данные формы.
//
// Черновик содержит только то, что удалось определить; всё остальное остаётся
// как было. Сохранения здесь нет: человек проверяет поля и жмёт «Сохранить».

import { formatAmountForInput } from './amountExpression';

export function applyQuickEntryDraft(prevFormData, draft, accounts = []) {
    const hasAccount = id => accounts.some(account => account._id === id);
    const type = draft.type === 'transfer' && accounts.length < 2
        ? 'expense'
        : ['expense', 'income', 'transfer'].includes(draft.type) ? draft.type : prevFormData.type;
    const next = { ...prevFormData, type };

    if (draft.amount !== undefined) next.amount = formatAmountForInput(draft.amount);
    if (draft.date) next.date = draft.date;
    if (typeof draft.description === 'string' && draft.description) next.description = draft.description;

    if (type === 'transfer') {
        // Те же правила, что у переключателя типа в форме: счёт по умолчанию -
        // наличные или первый, а "куда" всегда отличается от "откуда".
        const defaultAccount = accounts.find(account => account.type === 'cash')?._id || accounts[0]?._id || '';
        const from = hasAccount(draft.account) ? draft.account : (prevFormData.account || defaultAccount);
        const wanted = hasAccount(draft.toAccount) ? draft.toAccount : prevFormData.toAccount;
        next.account = from;
        next.toAccount = hasAccount(wanted) && wanted !== from ? wanted : (accounts.find(account => account._id !== from)?._id || '');
        return next;
    }

    // Категория принадлежит типу: после смены типа прежняя уже не годится.
    if (type !== prevFormData.type) next.category = '';
    if (draft.category) next.category = draft.category;
    if (hasAccount(draft.account)) next.account = draft.account;

    // Компания бывает только у расхода. Для дохода поля не трогаем: тип в
    // форме меняется так же, а при сохранении лишние поля отбрасываются.
    if (type === 'expense' && draft.companyName) {
        next.companyId = draft.companyId || '';
        next.companyName = draft.companyName;
        next.logoMode = draft.logoMode || 'auto';
        next.merchantDomain = draft.merchantDomain || '';
    }
    return next;
}
