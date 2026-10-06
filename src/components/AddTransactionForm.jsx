import { useState } from 'react';
import { ChevronDown, Trash2, X } from 'lucide-react';
import CompanyField from './CompanyField';
import Field, { FormLabel } from './ui/Field'
import Sheet from './ui/Sheet'
import Button from './ui/Button'
import IconButton from './ui/IconButton'
import SegmentedControl from './ui/SegmentedControl'
import Switch from './ui/Switch'
import AccountPicker from './transaction-form/AccountPicker'
import CategoryPicker from './transaction-form/CategoryPicker'
import DateField from './transaction-form/DateField'
import TransferAccounts from './transaction-form/TransferAccounts'
import SplitEditor from './transaction-form/SplitEditor'
import useSplits from './transaction-form/useSplits'
import useDescriptionSuggestions from './transaction-form/useDescriptionSuggestions'
import { buildSubmission } from './transaction-form/buildSubmission'
import { saveCompanySelection } from '../utils/companies';
import { toLocalDateInput } from '../utils/period';

export default function AddTransactionForm({ type = 'expense', initialData = null, categories = [], onAddCategory, onClose, onSubmit, onDelete, accounts = [], presetAccountId = null, transactions = [], categoryCounts, apiFetch }) {
    const defaultAccount = accounts.find(a => a.type === 'cash')?._id || accounts[0]?._id || 'cash';
    const defaultToAccount = accounts.find(a => a.type === 'card' && a._id !== defaultAccount)?._id || accounts.find(a => a._id !== defaultAccount)?._id || '';

    // For a brand-new income/expense transaction, the account must be an
    // explicit user choice - unless a specific account was already active
    // (presetAccountId) when the form was opened. A transfer opened with an
    // account active starts *from* that account, so the only thing left to
    // pick is the destination; with no account active (the "Общий капитал"
    // slide) it falls back to the defaultAccount/defaultToAccount pairing,
    // since an empty account on that flow would break its two from/to
    // selects for no gain.
    const initialAccount = initialData
        ? (initialData.account || defaultAccount)
        : (type === 'transfer' ? (presetAccountId || defaultAccount) : (presetAccountId || ''));

    // Keep the current destination when possible, including when returning
    // from income/expense mode after its account has changed.
    const getTransferDestination = (account, destination) =>
        accounts.some(a => a._id === destination && a._id !== account)
            ? destination
            : (accounts.find(a => a._id !== account)?._id || '');
    const initialToAccount = getTransferDestination(initialAccount, initialData?.toAccount || defaultToAccount);

    const [formData, setFormData] = useState(initialData ? {
        ...initialData,
        __v: Number.isInteger(initialData.__v) ? initialData.__v : 0,
        date: initialData.date || toLocalDateInput(),
        account: initialAccount,
        toAccount: initialToAccount
    } : {
        amount: '',
        category: '',
        description: '',
        ...(type === 'expense' ? { companyName: '', logoMode: 'category' } : {}),
        date: toLocalDateInput(),
        type: type, // 'income', 'expense', or 'transfer'
        account: initialAccount,
        toAccount: initialToAccount,
        excludeFromStats: false
    });

    const [companyLogoChanged, setCompanyLogoChanged] = useState(false);
    const [companyError, setCompanyError] = useState('');
    // Обычная категория выбранной компании и признак того, что текущую
    // категорию подставили мы, а не выбрал пользователь: такую можно молча
    // заменить при смене компании, выбранную руками - только предложить.
    const [usualCategory, setUsualCategory] = useState('');
    const [categoryAutoFilled, setCategoryAutoFilled] = useState(false);

    const isTransfer = formData.type === 'transfer';

    // Split Logic
    const [isSplit, setIsSplit] = useState(false);
    const split = useSplits(formData.amount);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // «Дополнительно»: свёрнуто, если у редактируемой операции там нет ничего
    // нестандартного (исключение из статистики). Без содержимого (перевод,
    // разделение) секции нет вовсе.
    const showExcludeToggle = !isTransfer && !isSplit;
    const [showExtra, setShowExtra] = useState(() => Boolean(initialData?.excludeFromStats));

    // Validation for split: check if split mode is active, remaining amount is approx 0, and all splits have data
    const isSplitValid = isSplit && split.isBalanced && split.isComplete;

    // Shared save-gate for both the submit button (disabled state) and the
    // submit handler (so the gate can't be bypassed some other way, e.g. an
    // Enter keypress). Transfers require two distinct existing accounts.
    const isSaveDisabled = isSubmitting
        || !(parseFloat(formData.amount) > 0)
        || (!isTransfer && !formData.account)
        || (isTransfer && (formData.account === formData.toAccount
            || !accounts.some(a => a._id === formData.account)
            || !accounts.some(a => a._id === formData.toAccount)))
        || (isSplit ? !isSplitValid : (!isTransfer && !formData.category));


    const handleSubmit = async (e) => {
        e.preventDefault();
        if (isSaveDisabled) return;

        setIsSubmitting(true);
        setCompanyError('');
        try {
            const savedForm = formData.type === 'expense' && formData.companyName?.trim() && (!formData.companyId || companyLogoChanged)
                ? await saveCompanySelection(formData, { request: apiFetch || fetch, logoChanged: companyLogoChanged })
                : formData;
            const submission = onSubmit(buildSubmission({ formData, savedForm, splits: split.splits, isSplit, initialData }));
            const succeeded = submission && typeof submission.then === 'function'
                ? await submission
                : submission;
            // Existing embedders that do not return a result retain the old
            // close-on-submit contract; App returns false on an API failure
            // so the user's entered values stay available for a retry.
            if (succeeded !== false) onClose();
        } catch (error) {
            setCompanyError(error.message || 'Не удалось сохранить операцию. Попробуйте ещё раз.');
        } finally {
            setIsSubmitting(false);
        }
    };

    // Both rows list every account; picking the one already chosen on the
    // opposite side swaps the sides, so from !== to always holds.
    const setTransferAccount = (side, id) => {
        setFormData(prev => {
            const otherSide = side === 'account' ? 'toAccount' : 'account';
            if (!accounts.some(a => a._id === id)) return prev;
            if (id === prev[otherSide]) return { ...prev, [side]: id, [otherSide]: prev[side] };
            return { ...prev, [side]: id };
        });
    };

    const swapTransferAccounts = () => {
        setFormData({ ...formData, account: formData.toAccount, toAccount: formData.account });
    };

    // Подсказки для поля комментария. В режиме разделения одно описание
    // относится сразу к нескольким категориям, поэтому подсказывать там нечего.
    const visibleSuggestions = useDescriptionSuggestions({
        transactions,
        category: isSplit ? null : (isTransfer ? 'Перевод' : formData.category),
        type: formData.type,
        apiFetch,
        typedText: formData.description,
    });

    const getTitle = () => {
        if (initialData) return 'Редактировать';
        if (isTransfer) return 'Перевод';
        return formData.type === 'income' ? 'Новый доход' : 'Новый расход';
    };

    // Do not let backdrop/close-button/Escape destroy the entered values
    // while the request is still in flight. Once a failed request settles,
    // the form becomes closable again and remains filled for a retry.
    const requestClose = () => {
        if (!isSubmitting) onClose();
    };

    // Обычная категория компании подставляется только в расходе без
    // разделения и только если такая категория у нас есть.
    const usualCategoryAvailable = formData.type === 'expense' && !isSplit
        && categories.some(c => c.type === 'expense' && c.name === usualCategory);
    const suggestedCategory = usualCategoryAvailable && formData.category && formData.category !== usualCategory ? usualCategory : '';
    const chooseCompany = ({ usualCategory: usual = '', ...choice }) => {
        setCompanyLogoChanged(false);
        setCompanyError('');
        setUsualCategory(usual);
        const fill = formData.type === 'expense' && !isSplit && usual
            && categories.some(c => c.type === 'expense' && c.name === usual)
            && (!formData.category || categoryAutoFilled);
        if (fill) setCategoryAutoFilled(true);
        setFormData(prev => ({ ...prev, ...choice, ...(fill ? { category: usual } : {}) }));
    };

    const changeType = (id) => setFormData(prev => {
        if (id !== 'transfer') return { ...prev, type: id };
        const account = prev.account || defaultAccount;
        return { ...prev, type: id, account, toAccount: getTransferDestination(account, prev.toAccount) };
    });


    return (
        <Sheet ariaLabel={getTitle()} onClose={requestClose}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0 }}>{getTitle()}</h3>
                    <IconButton round tone="neutral" onClick={requestClose} aria-label="Закрыть"><X size={20} strokeWidth={1.8} aria-hidden="true" /></IconButton>
                </div>

                {/* Type Toggle - Hide if splitting or editing */}
                {!initialData && !isSplit && (
                    <SegmentedControl
                        ariaLabel="Тип операции"
                        style={{ background: 'var(--color-surface-inset)' }}
                        options={[
                            { id: 'expense', label: 'Расход' },
                            { id: 'income', label: 'Доход' },
                            ...(accounts.length >= 2 ? [{ id: 'transfer', label: 'Перевод' }] : [])
                        ]}
                        value={formData.type}
                        onChange={changeType}
                    />
                )}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

                    {/* Main Amount Input */}
                    <div>
                        <FormLabel>
                            {isSplit ? 'Общая сумма' : 'Сумма'}
                        </FormLabel>
                        <div style={{ position: 'relative' }}>
                            <span style={{
                                position: 'absolute',
                                left: '16px',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                color: 'var(--color-text-muted)',
                                fontSize: 'var(--text-3xl)'
                            }}>€</span>
                            <Field
                                type="number"
                                tone="sunken"
                                size="xl"
                                inputMode="decimal"
                                step="0.01"
                                placeholder="0.00"
                                value={formData.amount}
                                onChange={e => setFormData({ ...formData, amount: e.target.value })}
                                style={{
                                    width: '100%',
                                    // слева оставлено место под знак валюты,
                                    // который лежит поверх поля
                                    padding: '16px 16px 16px 36px',
                                    fontSize: '1.5rem',
                                    fontWeight: 'var(--weight-strong)',
                                }}
                            />
                        </div>
                    </div>

                    {!isTransfer && (
                        <>
                            {/* Split Toggle */}
                            {!initialData && formData.amount && parseFloat(formData.amount) > 0 && (
                                <Switch checked={isSplit} onChange={setIsSplit} label="Разделить на несколько категорий" />
                            )}

                            {!isSplit ? (
                                <CategoryPicker
                                    categories={categories}
                                    transactions={transactions}
                                    type={formData.type}
                                    categoryCounts={categoryCounts}
                                    value={formData.category}
                                    onChange={category => { setCategoryAutoFilled(false); setFormData(prev => ({ ...prev, category })); }}
                                    onAddCategory={onAddCategory}
                                />
                            ) : (
                                <SplitEditor
                                    split={split}
                                    categories={categories}
                                    transactions={transactions}
                                    type={formData.type}
                                    categoryCounts={categoryCounts}
                                />
                            )}

                            {/* Account Selector (общий и для обычного режима, и для разделения) */}
                            <div>
                                <FormLabel>
                                    {formData.type === 'expense' ? 'Списать с' : 'Зачислить на'}
                                </FormLabel>
                                <AccountPicker
                                    accounts={accounts}
                                    value={formData.account}
                                    onChange={account => setFormData({ ...formData, account })}
                                />
                            </div>
                        </>
                    )}

                    {isTransfer && (
                        <TransferAccounts
                            accounts={accounts}
                            from={formData.account}
                            to={formData.toAccount}
                            onPick={setTransferAccount}
                            onSwap={swapTransferAccounts}
                        />
                    )}

                    <DateField value={formData.date} onChange={date => setFormData(prev => ({ ...prev, date }))} />

                    {formData.type === 'expense' && (
                        <CompanyField
                            item={formData}
                            transactions={transactions}
                            apiFetch={apiFetch}
                            logoChanged={companyLogoChanged}
                            onChange={chooseCompany}
                            onLogoChange={choice => { setCompanyLogoChanged(true); setFormData(prev => ({ ...prev, ...choice })); }}
                            onMerchantSelect={merchant => { setCompanyLogoChanged(true); setFormData(prev => ({ ...prev, companyId: '', companyName: merchant.name, logoMode: 'domain', merchantDomain: merchant.domain })); }}
                        >
                            {suggestedCategory && (
                                <div className="company-field__hint">
                                    <button type="button" onClick={() => { setCategoryAutoFilled(true); setFormData(prev => ({ ...prev, category: suggestedCategory })); }}>
                                        Обычно: {suggestedCategory}
                                    </button>
                                </div>
                            )}
                        </CompanyField>
                    )}

                    {/* Description */}
                    <div>
                        <FormLabel>Описание (опц.)</FormLabel>
                        <Field
                            type="text"
                            tone="sunken"
                            placeholder="Комментарий..."
                            value={formData.description}
                            onChange={e => setFormData({ ...formData, description: e.target.value })}
                            style={{ width: '100%' }}
                        />
                        {visibleSuggestions.length > 0 && (
                            <div
                                className="no-scrollbar"
                                style={{
                                    display: 'flex',
                                    gap: '8px',
                                    marginTop: '10px',
                                    // Одна строка с горизонтальной прокруткой:
                                    // перенос подсказок в несколько рядов
                                    // сдвигал бы кнопку сохранения вниз при
                                    // каждой смене категории.
                                    overflowX: 'auto',
                                    paddingBottom: '2px'
                                }}
                            >
                                {visibleSuggestions.map(suggestion => (
                                    <button
                                        key={suggestion}
                                        type="button"
                                        onClick={() => setFormData({ ...formData, description: suggestion })}
                                        style={{
                                            flex: '0 0 auto',
                                            maxWidth: '100%',
                                            padding: '6px 12px',
                                            borderRadius: 'var(--radius-lg)',
                                            border: '1px solid var(--color-border)',
                                            background: 'var(--color-surface)',
                                            color: 'var(--color-text-muted)',
                                            fontSize: 'var(--text-sm)',
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        {suggestion}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Дополнительно: редко нужные настройки спрятаны, чтобы
                        форма не вырастала на два экрана */}
                    {showExcludeToggle && (
                        <div>
                            <Button
                                tone="text"
                                size="sm"
                                aria-expanded={showExtra}
                                aria-controls="transaction-extra"
                                onClick={() => setShowExtra(v => !v)}
                                style={{ color: 'var(--color-text-muted)' }}
                            >
                                <ChevronDown
                                    size={18}
                                    strokeWidth={1.8}
                                    aria-hidden="true"
                                    style={{ transition: 'transform 0.2s', transform: showExtra ? 'rotate(180deg)' : 'none' }}
                                />
                                Дополнительно
                                {/* включённая настройка не должна быть невидимой */}
                                {!showExtra && showExcludeToggle && formData.excludeFromStats && (
                                    <span style={{ fontWeight: 'var(--weight-text)' }}>· не в статистике</span>
                                )}
                            </Button>
                            {showExtra && (
                                <div id="transaction-extra" style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '12px' }}>
                                    {/* Exclude from stats toggle */}
                                    {showExcludeToggle && (
                                        <Switch
                                            tone="negative"
                                            checked={Boolean(formData.excludeFromStats)}
                                            onChange={excludeFromStats => setFormData({ ...formData, excludeFromStats })}
                                            label="Не считать в статистике"
                                        />
                                    )}

                                </div>
                            )}
                        </div>
                    )}
                    {companyError && <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 'var(--text-sm)', margin: 0 }}>{companyError}</p>}

                    {/* Футер прилипает к низу листа, пока форма прокручивается.
                        Лист даёт нижний отступ 24px + safe-area, поэтому bottom
                        компенсирует его, а paddingBottom возвращает воздух. */}
                    <div style={{
                        position: 'sticky',
                        bottom: 'calc(-24px - env(safe-area-inset-bottom, 0px))',
                        zIndex: 1,
                        display: 'flex',
                        gap: '12px',
                        padding: '12px 0 calc(12px + env(safe-area-inset-bottom, 0px))',
                        background: 'var(--color-surface)',
                        boxShadow: 'var(--shadow-sticky-footer)'
                    }}>
                        {initialData && (
                            <Button
                                tone="danger"
                                size="lg"
                                aria-label="Удалить операцию"
                                disabled={isSubmitting}
                                onClick={async () => {
                                    if (isSubmitting) return;
                                    // Без confirm: App переносит запись в корзину
                                    // и показывает тост «Отменить»
                                    setIsSubmitting(true);
                                    try {
                                        const deletion = onDelete(initialData.id);
                                        const succeeded = deletion && typeof deletion.then === 'function'
                                            ? await deletion
                                            : deletion;
                                        if (succeeded !== false) onClose();
                                    } finally {
                                        setIsSubmitting(false);
                                    }
                                }}
                            >
                                <Trash2 size={22} strokeWidth={1.8} aria-hidden="true" />
                            </Button>
                        )}
                        <Button type="submit" size="lg" disabled={isSaveDisabled} style={{ flex: 1 }}>
                            {isSubmitting ? 'Сохранение...' : 'Сохранить'}
                        </Button>
                    </div>
                </form>
        </Sheet>
    );
}
