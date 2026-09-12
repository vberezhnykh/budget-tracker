import { useEffect, useId, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import TransactionIcon from './TransactionIcon';
import Field from './ui/Field';
import Chip from './ui/Chip';
import { getTransactionLogoUrl } from '../utils/logoDev';
import { normalizeMerchantDomain } from '../utils/merchantDomain';
import './TransactionLogoPicker.css';

export default function TransactionLogoPicker({ item, onChange, onMerchantSelect, apiFetch, fromHistory = false, canChoose = true }) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState({ status: 'idle', merchants: [], query: '' });
  const [website, setWebsite] = useState('');
  const [websiteError, setWebsiteError] = useState('');
  const [previewStatus, setPreviewStatus] = useState('disabled');
  const desiredUrl = getTransactionLogoUrl(item);
  const [previewUrl, setPreviewUrl] = useState(desiredUrl);
  const waitingForTyping = desiredUrl !== previewUrl;
  const mode = item.logoMode || 'auto';
  const request = apiFetch || fetch;

  // Typing a description should make one preview request after the pause,
  // not a network call for every character. The fallback is visible meanwhile.
  useEffect(() => {
    const timer = setTimeout(() => setPreviewUrl(desiredUrl), 400);
    return () => clearTimeout(timer);
  }, [desiredUrl]);

  useEffect(() => {
    const term = query.trim();
    if (!open || term.length < 2) return;
    const controller = new AbortController();
    let current = true;
    const timer = setTimeout(async () => {
      setSearch({ status: 'loading', merchants: [], query: term });
      try {
        const response = await request(`/api/merchants/search?q=${encodeURIComponent(term)}`, { signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 429 ? 'rate-limit' : 'unavailable');
        const body = await response.json();
        if (!Array.isArray(body.merchants)) throw new Error('unavailable');
        const merchants = body.merchants.filter(merchant =>
          typeof merchant.name === 'string' && normalizeMerchantDomain(merchant.domain) === merchant.domain).slice(0, 10);
        if (current) setSearch({ status: 'ready', merchants, query: term });
      } catch (error) {
        if (current) setSearch({ status: error.message === 'rate-limit' ? 'rate-limit' : 'error', merchants: [], query: term });
      }
    }, 400);
    return () => { current = false; clearTimeout(timer); controller.abort(); };
  }, [open, query, request]);

  const choose = (logoMode, merchantDomain = '') => {
    onChange({ logoMode, merchantDomain });
    setOpen(false);
  };
  const openPicker = () => {
    setQuery((item.companyName ?? (item.description || item.title || '')).slice(0, 120));
    setWebsite(mode === 'domain' ? item.merchantDomain || '' : '');
    setWebsiteError('');
    setSearch({ status: 'idle', merchants: [], query: '' });
    setOpen(true);
  };
  const applyWebsite = () => {
    const domain = normalizeMerchantDomain(website);
    if (!domain) { setWebsiteError('Укажите сайт компании, например company.com'); return; }
    choose('domain', domain);
  };
  const statusText = waitingForTyping || previewStatus === 'loading'
    ? 'Загружаем предпросмотр…'
    : previewStatus === 'error'
      ? 'Логотип не найден или недоступен — показана категория'
      : mode === 'category' || !desiredUrl
        ? fromHistory && mode === 'category' ? 'Иконка категории из истории' : 'Иконка категории'
        : mode === 'domain' ? `${fromHistory ? 'Из истории' : 'Выбрано'}: ${item.merchantDomain}` : 'Автоподбор по названию — проверьте совпадение';
  const currentSearch = search.query === query.trim();

  return (
    <section className="transaction-logo-picker" aria-label="Иконка операции">
      <div className="transaction-logo-picker__preview">
        <TransactionIcon
          item={waitingForTyping ? { ...item, logoMode: 'category' } : item}
          loading="eager"
          onLogoStateChange={setPreviewStatus}
        />
        <div className="transaction-logo-picker__copy">
          <strong>Иконка в истории</strong>
          <span role="status">{statusText}</span>
        </div>
        {canChoose && <button type="button" className="transaction-logo-picker__action" aria-label={open ? 'Закрыть выбор иконки' : 'Выбрать иконку'} aria-expanded={open} aria-controls={panelId} onClick={() => open ? setOpen(false) : openPicker()}>
          {open ? <X size={18} aria-label="Закрыть выбор" /> : 'Выбрать'}
        </button>}
      </div>

      {open && canChoose && (
        <div id={panelId} className="transaction-logo-picker__panel">
          <div className="transaction-logo-picker__modes">
            <Chip selected={mode === 'auto'} onClick={() => choose('auto')}>Автоподбор</Chip>
            <Chip selected={mode === 'category'} onClick={() => choose('category')}>Иконка категории</Chip>
          </div>
          <label className="transaction-logo-picker__label" htmlFor={`${panelId}-search`}>Найти компанию</label>
          <div className="transaction-logo-picker__search">
            <Search size={17} aria-hidden="true" />
            <Field id={`${panelId}-search`} type="search" maxLength={120} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} placeholder="Например, Chop Chop" autoComplete="off" style={{ width: '100%', paddingLeft: '36px' }} />
          </div>
          <p className="transaction-logo-picker__hint">Сверьте название и сайт: у компаний бывают одинаковые имена.</p>
          <div aria-live="polite" className="transaction-logo-picker__hint">
            {query.trim().length < 2 ? 'Введите хотя бы 2 символа'
              : !currentSearch || search.status === 'loading' ? 'Ищем компании…'
                : search.status === 'error' ? 'Каталог сейчас недоступен. Можно указать сайт вручную.'
                  : search.status === 'rate-limit' ? 'Много запросов. Попробуйте через минуту или укажите сайт.'
                    : search.status === 'ready' && search.merchants.length === 0 ? 'Ничего не найдено. Попробуйте другое написание или укажите сайт.' : null}
          </div>
          {currentSearch && search.status === 'ready' && search.merchants.length > 0 && (
            <ul className="transaction-logo-picker__results" aria-label="Найденные компании">
              {search.merchants.map(merchant => (
                <li key={merchant.domain}>
                  <button type="button" onClick={() => { if (onMerchantSelect) { onMerchantSelect(merchant); setOpen(false); } else choose('domain', merchant.domain); }}>
                    <TransactionIcon item={{ ...item, logoMode: 'domain', merchantDomain: merchant.domain }} />
                    <span className="transaction-logo-picker__copy"><strong>{merchant.name}</strong><span>{merchant.domain}</span></span>
                    {mode === 'domain' && item.merchantDomain === merchant.domain && <Check size={18} aria-hidden="true" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label className="transaction-logo-picker__label" htmlFor={`${panelId}-website`}>Или укажите сайт компании</label>
          <div className="transaction-logo-picker__website">
            <Field id={`${panelId}-website`} value={website} onChange={event => { setWebsite(event.target.value); setWebsiteError(''); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); applyWebsite(); } }} placeholder="company.com" autoComplete="off" autoCapitalize="none" spellCheck={false} aria-invalid={Boolean(websiteError)} aria-describedby={websiteError ? `${panelId}-error` : undefined} style={{ flex: 1, minWidth: 0 }} />
            <button type="button" className="transaction-logo-picker__action" onClick={applyWebsite}>Применить</button>
          </div>
          {websiteError && <p id={`${panelId}-error`} className="transaction-logo-picker__error" role="alert">{websiteError}</p>}
        </div>
      )}
    </section>
  );
}
