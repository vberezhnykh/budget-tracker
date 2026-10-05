import { useEffect, useId, useMemo, useState } from 'react';
import Field from './ui/Field';
import TransactionIcon from './TransactionIcon';
import LogoPickerPanel from './LogoPickerPanel';
import { companyKey, getCompanySuggestions } from '../utils/companies';
import { getTransactionLogoUrl } from '../utils/logoDev';
import './CompanyField.css';

// onChange - выбор самой компании; onLogoChange/onMerchantSelect - ручная смена
// логотипа (форма помечает её, чтобы запомнить выбор в записи компании).
// children рисуются в конце блока: форма кладёт туда подсказку «Обычно: …».
export default function CompanyField({ item, transactions, onChange, onLogoChange, onMerchantSelect, logoChanged = false, apiFetch, children }) {
  const id = useId();
  const [companies, setCompanies] = useState([]);
  const [status, setStatus] = useState('loading');
  const [focused, setFocused] = useState(false);
  const [retry, setRetry] = useState(0);
  const [history, setHistory] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [previewStatus, setPreviewStatus] = useState('disabled');
  const panelId = useId();
  const request = apiFetch || fetch;
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    Promise.resolve().then(() => request('/api/companies', { signal: controller.signal })).then(async response => {
      if (!response.ok) throw new Error('unavailable');
      const body = await response.json();
      if (!Array.isArray(body)) throw new Error('unavailable');
      if (current) { setCompanies(body); setStatus('ready'); }
    }).catch(() => { if (current) setStatus('error'); });
    return () => { current = false; controller.abort(); };
  }, [request, retry]);

  const query = item.companyName || '';
  useEffect(() => {
    if (!apiFetch || !focused) return;
    let current = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      request(`/api/companies/history?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then(async response => {
          if (!response.ok) throw new Error();
          const values = await response.json();
          if (current && Array.isArray(values)) setHistory({ query, values });
        }).catch(() => {});
    }, 250);
    return () => { current = false; clearTimeout(timer); controller.abort(); };
  }, [apiFetch, request, focused, query]);
  const historyTransactions = history?.query === query ? history.values : transactions;
  const suggestions = useMemo(() => getCompanySuggestions(companies, historyTransactions, item.companyName, item.category), [companies, historyTransactions, item.companyName, item.category]);

  const canChoose = item.companyName === undefined || Boolean(item.companyName.trim());
  const hasCompany = Boolean(item.companyName?.trim());
  const mode = item.logoMode || 'auto';
  // Адрес логотипа печатается по буквам, а запрос за превью нужен один после
  // паузы; пока ждём, показываем иконку категории.
  const desiredUrl = getTransactionLogoUrl(item);
  const [previewUrl, setPreviewUrl] = useState(desiredUrl);
  const waitingForTyping = desiredUrl !== previewUrl;
  useEffect(() => {
    const timer = setTimeout(() => setPreviewUrl(desiredUrl), 400);
    return () => clearTimeout(timer);
  }, [desiredUrl]);

  const choose = company => {
    onChange({ companyId: company._id || '', companyName: company.name, logoMode: company.logoMode || 'auto', merchantDomain: company.merchantDomain || '', usualCategory: company.category });
    setFocused(false);
    setPanelOpen(false);
  };
  const changeName = value => {
    const exact = companies.find(company => companyKey(company.name) === companyKey(value));
    if (exact) {
      onChange({ companyId: exact._id, companyName: value, logoMode: exact.logoMode || 'auto', merchantDomain: exact.merchantDomain || '', usualCategory: exact.category });
      setFocused(true);
      return;
    }
    const historical = getCompanySuggestions([], historyTransactions, value).find(company => companyKey(company.name) === companyKey(value));
    if (historical) {
      onChange({ companyId: '', companyName: value, logoMode: historical.logoMode, merchantDomain: historical.merchantDomain, usualCategory: historical.category });
    } else {
      onChange({ companyId: '', companyName: value, logoMode: value.trim() ? 'auto' : 'category', merchantDomain: '' });
    }
    setFocused(true);
  };
  const togglePanel = () => { setFocused(false); setPanelOpen(open => !open); };
  const changeLogo = choice => { onLogoChange?.(choice); };
  const pickCategoryIcon = () => { changeLogo({ logoMode: 'category', merchantDomain: '' }); setPanelOpen(false); };

  // Статус логотипа и одно-касание действия под полем; текст в role="status",
  // чтобы смену состояния озвучивали.
  let statusText;
  let actions = [];
  const openPanelAction = label => ({ label, onClick: () => setPanelOpen(true) });
  if (!canChoose) {
    statusText = 'Укажите компанию, чтобы подобрать логотип';
  } else if (mode === 'category') {
    statusText = 'Иконка категории';
    actions = [{ label: 'Подобрать логотип', onClick: () => changeLogo({ logoMode: 'auto', merchantDomain: '' }) }];
  } else if (!desiredUrl) {
    statusText = 'Иконка категории';
    actions = [openPanelAction('Найти логотип')];
  } else if (waitingForTyping || previewStatus === 'loading') {
    statusText = 'Загружаем логотип…';
  } else if (previewStatus === 'error') {
    statusText = 'Логотип не найден — показана иконка категории';
    actions = [openPanelAction('Найти логотип')];
  } else if (mode === 'domain') {
    statusText = `Логотип: ${item.merchantDomain}`;
    actions = [{ label: 'Иконка категории', onClick: pickCategoryIcon }, openPanelAction('Изменить')];
  } else {
    statusText = 'Логотип подобран по названию';
    actions = [{ label: 'Иконка категории', onClick: pickCategoryIcon }, openPanelAction('Другой логотип')];
  }
  if (logoChanged && hasCompany) statusText += ` · запомним для «${item.companyName.trim()}»`;
  const previewItem = waitingForTyping ? { ...item, logoMode: 'category' } : item;
  const icon = <TransactionIcon item={previewItem} loading="eager" onLogoStateChange={setPreviewStatus} />;

  return (
    <div className="company-field">
      <label htmlFor={id}>Компания (необязательно)</label>
      <div className="company-field__input">
        <div className="company-field__control">
          {canChoose
            ? <button type="button" className="company-field__icon" aria-label={panelOpen ? 'Закрыть выбор иконки' : 'Выбрать иконку'} aria-expanded={panelOpen} aria-controls={panelId} onClick={togglePanel}>{icon}</button>
            : <span className="company-field__icon">{icon}</span>}
          <Field id={id} value={item.companyName || ''} onChange={event => changeName(event.target.value)} onFocus={() => setFocused(true)} onBlur={event => { if (!event.currentTarget.parentElement.parentElement.contains(event.relatedTarget)) setFocused(false); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); setFocused(false); } if (event.key === 'Escape') setFocused(false); }} maxLength={120} placeholder="Название магазина или сервиса" autoComplete="off" style={{ width: '100%', paddingLeft: '46px' }} />
        </div>
        {item.companyName && <button type="button" onClick={() => { setPanelOpen(false); changeName(''); }} aria-label="Убрать компанию">×</button>}
      </div>
      {focused && suggestions.length > 0 && (
        <ul className="company-field__suggestions" aria-label="Знакомые компании">
          {suggestions.map(company => (
            <li key={company._id || companyKey(company.name)}><button type="button" onMouseDown={event => event.preventDefault()} onClick={() => choose(company)}>
              <TransactionIcon item={{ type: 'expense', companyName: company.name, category: item.category, logoMode: company.logoMode, merchantDomain: company.merchantDomain }} />
              <span><strong>{company.name}</strong><small>{company.source === 'saved' ? 'Сохранённая компания' : 'Из истории'}{company.merchantDomain ? ` · ${company.merchantDomain}` : ''}</small></span>
            </button></li>
          ))}
        </ul>
      )}
      <div className="company-field__hint">
        <span role="status">{statusText}</span>
        {actions.map(action => <button key={action.label} type="button" onClick={action.onClick}>{action.label}</button>)}
      </div>
      {status === 'error' && <div className="company-field__hint">Список компаний недоступен. <button type="button" onClick={() => { setStatus('loading'); setRetry(value => value + 1); }}>Повторить</button></div>}
      {panelOpen && canChoose && (
        <LogoPickerPanel id={panelId} item={item} apiFetch={apiFetch} onChange={changeLogo} onMerchantSelect={onMerchantSelect} onClose={() => setPanelOpen(false)} />
      )}
      {children}
    </div>
  );
}
