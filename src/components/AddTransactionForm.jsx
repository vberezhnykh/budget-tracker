import { useEffect, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import CompanyField from './CompanyField';
import Field, { FormLabel } from './ui/Field'
import Sheet from './ui/Sheet'
import Button from './ui/Button'
import IconButton from './ui/IconButton'
import InlineAlert from './ui/InlineAlert'
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
import { getLimitHint } from './transaction-form/limitHint'
import { saveCompanySelection } from '../utils/companies';
import { toLocalDateInput } from '../utils/period';
import './AddTransactionForm.css';

// Заголовок и подпись кнопки по типу операции.
const TYPE_TITLES = { expense: 'Расход', income: 'Доход', transfer: 'Перевод' };
const SAVE_LABELS = { expense: 'Сохранить расход', income: 'Сохранить доход', transfer: 'Сохранить перевод' };

// Поля формы: высота 48px и тот же радиус, что у чипов (задаёт сам Field).
const FORM_FIELD_STYLE = { width: '100%', minHeight: '48px' };

// Сообщение об ошибке заканчивается точкой, чтобы за ним можно было
// дописать следующую фразу.
const withPeriod = (message) => (/[.!?…]$/.test(message) ? message : `${message}.`);

// monthlyLimit и monthExpense (расход текущего месяца по всем счетам, число
// без знака) нужны только подсказке «после него можно потратить»: нет любого
// из них - подсказки нет.
//
// onSubmit сообщает исход сохранения. Результат false или { error } - не
// сохранилось: лист остаётся открытым со всем введённым, над кнопкой встаёт
// плашка с причиной. { cancelled: true } - пользователь сам отказался
// (например, от слияния с банковской записью): лист остаётся, плашки нет.
// Любое другое значение (включая undefined у простых вызывающих) - успех.
export default function AddTransactionForm({ type = 'expense', initialData = null, categories = [], onAddCategory, onClose, onSubmit, onDelete, accounts = [], presetAccountId = null, transactions = [], categoryCounts, apiFetch, monthlyLimit, monthExpense }) {
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
    // Не сохранилось: причина и слепок формы на тот момент. Пока форма не
    // изменилась, плашка стоит над кнопкой, а кнопка зовёт «ещё раз»; любая
    // правка (поле, часть разделения, режим) снимает и то и другое.
    const [failure, setFailure] = useState(null);
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

    // Свежее состояние формы для слепка ошибки: правка во время запроса
    // не должна спрятать причину, по которой он провалился.
    const latestRef = useRef({ formData, splits: split.splits, isSplit });
    useEffect(() => {
        latestRef.current = { formData, splits: split.splits, isSplit };
    });
    const activeFailure = failure
        && failure.formData === formData && failure.splits === split.splits && failure.isSplit === isSplit
        ? failure : null;

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
        setFailure(null);
        const fail = (message) => setFailure({ message, ...latestRef.current });
        try {
            const savedForm = formData.type === 'expense' && formData.companyName?.trim() && (!formData.companyId || companyLogoChanged)
                ? await saveCompanySelection(formData, { request: apiFetch || fetch, logoChanged: companyLogoChanged })
                : formData;
            const submission = onSubmit(buildSubmission({ formData, savedForm, splits: split.splits, isSplit, initialData }));
            const result = submission && typeof submission.then === 'function'
                ? await submission
                : submission;
            // Existing embedders that do not return a result retain the old
            // close-on-submit contract; App reports an API failure so the
            // user's entered values stay available for a retry.
            if (result === false) {
                fail(initialData ? 'Не удалось сохранить изменения' : 'Не удалось сохранить операцию');
            } else if (typeof result?.error === 'string') {
                fail(result.error || 'Не удалось сохранить операцию');
            } else if (!result?.cancelled) {
                onClose();
            }
        } catch (error) {
            fail(error.message || 'Не удалось сохранить операцию. Попробуйте ещё раз.');
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


    const limitHint = getLimitHint({
        type: formData.type,
        isEditing: Boolean(initialData),
        excludeFromStats: Boolean(formData.excludeFromStats),
        date: formData.date,
        monthlyLimit,
        monthExpense,
        amount: formData.amount,
    });

    // «Разделить» предлагается, когда есть что делить; уже начатое разделение
    // можно отменить всегда, иначе очистка суммы заперла бы форму в нём.
    const canToggleSplit = isSplit || (!initialData && formData.amount && parseFloat(formData.amount) > 0);

    // Ширина поля суммы следует за введённым: так «€» стоит вплотную к числу,
    // а группа остаётся по центру листа.
    const amountWidth = `${Math.min(Math.max(String(formData.amount).length, 4), 10) + 1}ch`;

    return (
        <Sheet ariaLabel={getTitle()} onClose={requestClose}>
                {/* Шапка: у новой операции слева переключатель типа, у
                    правки - заголовок с типом; крестик всегда справа. Во
                    время разделения тип менять нельзя, и слева пусто. */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)' }}>
                    {initialData ? (
                        <h2 style={{ margin: 0, fontSize: 'var(--text-3xl)', fontWeight: 'var(--weight-strong)' }}>{TYPE_TITLES[formData.type] || 'Операция'}</h2>
                    ) : !isSplit ? (
                        <SegmentedControl
                            ariaLabel="Тип операции"
                            style={{ flex: 1, background: 'var(--color-surface-inset)' }}
                            options={[
                                { id: 'expense', label: 'Расход' },
                                { id: 'income', label: 'Доход' },
                                ...(accounts.length >= 2 ? [{ id: 'transfer', label: 'Перевод' }] : [])
                            ]}
                            value={formData.type}
                            onChange={changeType}
                        />
                    ) : <span />}
                    <IconButton round tone="neutral" onClick={requestClose} aria-label="Закрыть"><X size={20} strokeWidth={1.8} aria-hidden="true" /></IconButton>
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>

                    {/* Сумма: крупное число по центру без рамки */}
                    <div style={{ textAlign: 'center' }}>
                        <FormLabel htmlFor="transaction-amount" style={{ textAlign: 'center' }}>
                            {isSplit ? 'Общая сумма' : 'Сумма'}
                        </FormLabel>
                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'baseline', gap: 'var(--space-1)' }}>
                            <span
                                aria-hidden="true"
                                style={{ color: 'var(--color-text-muted)', fontSize: '2rem', fontWeight: 'var(--weight-strong)', lineHeight: 1.2 }}
                            >€</span>
                            <Field
                                id="transaction-amount"
                                className="transaction-amount-input"
                                type="number"
                                inputMode="decimal"
                                step="0.01"
                                placeholder="0"
                                value={formData.amount}
                                onChange={e => setFormData({ ...formData, amount: e.target.value })}
                                style={{
                                    width: amountWidth,
                                    maxWidth: 'calc(100% - 3rem)',
                                    padding: 0,
                                    border: 'none',
                                    background: 'transparent',
                                    textAlign: 'center',
                                    fontSize: '3rem',
                                    fontWeight: 'var(--weight-strong)',
                                    letterSpacing: '-1.5px',
                                    lineHeight: 1.2,
                                }}
                            />
                        </div>
                        {limitHint && (
                            <p
                                data-testid="limit-hint"
                                style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--text-sm)', textAlign: 'center', color: limitHint.exceeded ? 'var(--color-negative)' : 'var(--color-text-muted)' }}
                            >
                                {limitHint.text}
                            </p>
                        )}
                    </div>

                    {!isTransfer && (
                        <>
                            {/* Категория: справа от подписи - переключатель разделения */}
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', minHeight: '28px', marginBottom: 'var(--space-2)' }}>
                                    <FormLabel style={{ margin: 0 }}>Категория</FormLabel>
                                    {canToggleSplit && (
                                        <Button
                                            tone="text"
                                            aria-pressed={isSplit}
                                            onClick={() => setIsSplit(v => !v)}
                                            style={{ minHeight: '28px', padding: '0 var(--space-1)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-label)' }}
                                        >
                                            {isSplit ? 'Не разделять' : 'Разделить'}
                                        </Button>
                                    )}
                                </div>

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
                            </div>

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

                    {/* Comment */}
                    <div>
                        <FormLabel htmlFor="transaction-comment">Комментарий</FormLabel>
                        <Field
                            id="transaction-comment"
                            type="text"
                            placeholder="Необязательно"
                            value={formData.description}
                            onChange={e => setFormData({ ...formData, description: e.target.value })}
                            style={FORM_FIELD_STYLE}
                        />
                        {visibleSuggestions.length > 0 && (
                            <div
                                className="no-scrollbar"
                                style={{
                                    display: 'flex',
                                    gap: 'var(--space-2)',
                                    marginTop: 'var(--space-3)',
                                    // Одна строка с горизонтальной прокруткой:
                                    // перенос подсказок в несколько рядов
                                    // сдвигал бы кнопку сохранения вниз при
                                    // каждой смене категории.
                                    overflowX: 'auto',
                                    paddingBottom: 'var(--space-1)'
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
                                            padding: 'var(--space-1-5) var(--space-3)',
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
                                <div id="transaction-extra" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', marginTop: 'var(--space-3)' }}>
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

                    {/* Футер прилипает к низу листа, пока форма прокручивается.
                        Лист даёт нижний отступ 24px + safe-area, поэтому bottom
                        компенсирует его, а paddingBottom возвращает воздух.
                        Плашка ошибки лежит прямо над кнопкой, в футере: так
                        причину видно, даже когда форма прокручена вверх. */}
                    <div style={{
                        position: 'sticky',
                        bottom: 'calc(-24px - env(safe-area-inset-bottom, 0px))',
                        zIndex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--space-3)',
                        padding: 'var(--space-3) 0 calc(var(--space-3) + env(safe-area-inset-bottom, 0px))',
                        background: 'var(--color-surface)',
                        boxShadow: 'var(--shadow-sticky-footer)'
                    }}>
                        {activeFailure && (
                            <InlineAlert tone="danger" title="Не сохранилось.">
                                {`${withPeriod(activeFailure.message)} Все введённое осталось в форме.`}
                            </InlineAlert>
                        )}
                        <Button type="submit" size="lg" block disabled={isSaveDisabled} style={{ minHeight: '54px' }}>
                            {isSubmitting ? 'Сохранение...' : activeFailure ? 'Сохранить ещё раз' : initialData ? 'Сохранить' : (SAVE_LABELS[formData.type] || 'Сохранить')}
                        </Button>
                        {initialData && (
                            <Button
                                tone="text"
                                block
                                disabled={isSubmitting}
                                style={{ minHeight: '44px', color: 'var(--color-danger)' }}
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
                                Удалить операцию
                            </Button>
                        )}
                    </div>
                </form>
        </Sheet>
    );
}
