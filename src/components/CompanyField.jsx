import { useEffect, useId, useMemo, useState } from 'react';
import Field from './ui/Field';
import TransactionIcon from './TransactionIcon';
import { companyKey, getCompanySuggestions } from '../utils/companies';
import './CompanyField.css';

export default function CompanyField({ item, transactions, onChange, apiFetch }) {
  const id = useId();
  const [companies, setCompanies] = useState([]);
  const [status, setStatus] = useState('loading');
  const [focused, setFocused] = useState(false);
  const [retry, setRetry] = useState(0);
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

  const suggestions = useMemo(() => getCompanySuggestions(companies, transactions, item.companyName), [companies, transactions, item.companyName]);
  const choose = company => {
    onChange({ companyId: company._id || '', companyName: company.name, logoMode: company.logoMode || 'auto', merchantDomain: company.merchantDomain || '' });
    setFocused(false);
  };
  const changeName = value => {
    const exact = companies.find(company => companyKey(company.name) === companyKey(value));
    if (exact) {
      onChange({ companyId: exact._id, companyName: value, logoMode: exact.logoMode || 'auto', merchantDomain: exact.merchantDomain || '' });
      setFocused(true);
      return;
    }
    const historical = getCompanySuggestions([], transactions, value).find(company => companyKey(company.name) === companyKey(value));
    if (historical) {
      onChange({ companyId: '', companyName: value, logoMode: historical.logoMode, merchantDomain: historical.merchantDomain });
    } else {
      onChange({ companyId: '', companyName: value, logoMode: value.trim() ? 'auto' : 'category', merchantDomain: '' });
    }
    setFocused(true);
  };
  return (
    <div className="company-field">
      <label htmlFor={id}>Компания (необязательно)</label>
      <div className="company-field__input">
        <Field id={id} value={item.companyName || ''} onChange={event => changeName(event.target.value)} onFocus={() => setFocused(true)} onBlur={event => { if (!event.currentTarget.parentElement.parentElement.contains(event.relatedTarget)) setFocused(false); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); setFocused(false); } if (event.key === 'Escape') setFocused(false); }} maxLength={120} placeholder="Название магазина или сервиса" autoComplete="off" style={{ width: '100%' }} />
        {item.companyName && <button type="button" onClick={() => changeName('')} aria-label="Убрать компанию">×</button>}
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
      {status === 'error' ? <div className="company-field__hint">Список компаний недоступен. <button type="button" onClick={() => { setStatus('loading'); setRetry(value => value + 1); }}>Повторить</button></div>
        : <div className="company-field__hint">{item.companyId ? 'Компания выбрана. Описание покупки можно написать отдельно.' : 'Новая компания сохранится вместе с операцией. Логотип можно выбрать ниже.'}</div>}
    </div>
  );
}
