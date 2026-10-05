import { ListSkeleton } from './ui/Skeleton';
import { useEffect, useState } from 'react';
import { Check, Search } from 'lucide-react';
import TransactionIcon from './TransactionIcon';
import Field from './ui/Field';
import Chip from './ui/Chip';
import { normalizeMerchantDomain } from '../utils/merchantDomain';
import './LogoPickerPanel.css';

// Панель выбора логотипа под полем компании: режим, поиск по каталогу, сайт.
// Превью и статус живут в CompanyField, здесь только сам выбор. Монтируется
// при открытии, поэтому начальные значения полей берутся из item один раз.
export default function LogoPickerPanel({ id, item, onChange, onMerchantSelect, onClose, apiFetch }) {
  const [query, setQuery] = useState((item.companyName ?? (item.description || item.title || '')).slice(0, 120));
  const [search, setSearch] = useState({ status: 'idle', merchants: [], query: '' });
  const mode = item.logoMode || 'auto';
  const [website, setWebsite] = useState(mode === 'domain' ? item.merchantDomain || '' : '');
  const [websiteError, setWebsiteError] = useState('');
  const request = apiFetch || fetch;

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) return;
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
  }, [query, request]);

  const choose = (logoMode, merchantDomain = '') => {
    onChange({ logoMode, merchantDomain });
    onClose();
  };
  const applyWebsite = () => {
    const domain = normalizeMerchantDomain(website);
    if (!domain) { setWebsiteError('Укажите сайт компании, например company.com'); return; }
    choose('domain', domain);
  };
  const currentSearch = search.query === query.trim();

  return (
    <div id={id} className="logo-picker-panel">
      <div className="logo-picker-panel__modes">
        <Chip selected={mode === 'auto'} onClick={() => choose('auto')}>Автоподбор</Chip>
        <Chip selected={mode === 'category'} onClick={() => choose('category')}>Иконка категории</Chip>
      </div>
      <label className="logo-picker-panel__label" htmlFor={`${id}-search`}>Найти компанию</label>
      <div className="logo-picker-panel__search">
        <Search size={17} aria-hidden="true" />
        <Field id={`${id}-search`} type="search" maxLength={120} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} placeholder="Например, Chop Chop" autoComplete="off" style={{ width: '100%', paddingLeft: '36px' }} />
      </div>
      <p className="logo-picker-panel__hint">Сверьте название и сайт: у компаний бывают одинаковые имена.</p>
      <div aria-live="polite" className="logo-picker-panel__hint">
        {query.trim().length < 2 ? 'Введите хотя бы 2 символа'
          : !currentSearch || search.status === 'idle' || search.status === 'loading' ? <ListSkeleton label="Ищем компании…" rows={2} amounts={false} />
            : search.status === 'error' ? 'Каталог сейчас недоступен. Можно указать сайт вручную.'
              : search.status === 'rate-limit' ? 'Много запросов. Попробуйте через минуту или укажите сайт.'
                : search.status === 'ready' && search.merchants.length === 0 ? 'Ничего не найдено. Попробуйте другое написание или укажите сайт.' : null}
      </div>
      {currentSearch && search.status === 'ready' && search.merchants.length > 0 && (
        <ul className="logo-picker-panel__results" aria-label="Найденные компании">
          {search.merchants.map(merchant => (
            <li key={merchant.domain}>
              <button type="button" onClick={() => { if (onMerchantSelect) { onMerchantSelect(merchant); onClose(); } else choose('domain', merchant.domain); }}>
                <TransactionIcon item={{ ...item, logoMode: 'domain', merchantDomain: merchant.domain }} />
                <span className="logo-picker-panel__copy"><strong>{merchant.name}</strong><span>{merchant.domain}</span></span>
                {mode === 'domain' && item.merchantDomain === merchant.domain && <Check size={18} aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="logo-picker-panel__label" htmlFor={`${id}-website`}>Или укажите сайт компании</label>
      <div className="logo-picker-panel__website">
        <Field id={`${id}-website`} value={website} onChange={event => { setWebsite(event.target.value); setWebsiteError(''); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); applyWebsite(); } }} placeholder="company.com" autoComplete="off" autoCapitalize="none" spellCheck={false} aria-invalid={Boolean(websiteError)} aria-describedby={websiteError ? `${id}-error` : undefined} style={{ flex: 1, minWidth: 0 }} />
        <button type="button" className="logo-picker-panel__action" onClick={applyWebsite}>Применить</button>
      </div>
      {websiteError && <p id={`${id}-error`} className="logo-picker-panel__error" role="alert">{websiteError}</p>}
    </div>
  );
}
