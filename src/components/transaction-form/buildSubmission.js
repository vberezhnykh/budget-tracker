// Собирает то, что форма отдаёт в onSubmit: массив частей при разделении,
// иначе одна операция. Чистая функция: время и случайность приходят
// параметрами, чтобы id в тестах были предсказуемыми.
//
// savedForm - formData после сохранения компании (в нём уже есть companyId);
// поля логотипа и компании идут только в расходе, у дохода и перевода их нет.
export function buildSubmission({
    formData,
    savedForm = formData,
    splits = [],
    isSplit = false,
    initialData = null,
    now = Date.now,
    random = Math.random,
}) {
    const isTransfer = formData.type === 'transfer';
    const isExpense = formData.type === 'expense';

    if (isSplit && splits.length > 0) {
        const splitId = `split_${now()}`;
        return splits.map(split => ({
            title: split.category,
            amount: parseFloat(split.amount),
            category: split.category,
            description: (formData.description || '').trim(),
            ...(isExpense ? {
                logoMode: savedForm.logoMode || 'auto', merchantDomain: savedForm.merchantDomain || '',
                ...(savedForm.companyName !== undefined ? { companyName: savedForm.companyName, companyId: savedForm.companyId || '' } : {}),
            } : {}),
            date: formData.date,
            type: formData.type,
            account: formData.account,
            toAccount: formData.toAccount,
            splitId,
            id: now() + random()
        }));
    }

    const submitData = {
        ...savedForm,
        amount: parseFloat(formData.amount),
        category: isTransfer ? 'Перевод' : formData.category,
        id: initialData ? initialData.id : now()
    };
    // toAccount есть только у перевода, иначе он засорял бы данные
    if (!isTransfer) delete submitData.toAccount;
    if (!isExpense) {
        delete submitData.logoMode;
        delete submitData.merchantDomain;
        delete submitData.companyName;
        delete submitData.companyId;
    }
    return submitData;
}
