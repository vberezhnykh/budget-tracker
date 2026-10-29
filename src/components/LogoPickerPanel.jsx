import { ListSkeleton } from './ui/Skeleton';
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import TransactionIcon from './TransactionIcon';
import Field from './ui/Field';
import ListRow from './ui/ListRow';
import Button from './ui/Button';
import { normalizeMerchantDomain } from '../utils/merchantDomain';

// Подпись раздела на листе «Где»: мелкая, серая, с весом label.
const SECTION_LABEL_STYLE = { color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-label)' };
const HINT_STYLE = { color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', lineHeight: 1.5 };

// Выбор значка «По сайту» на листе «Где»: сайт компании и каталог похожих
// компаний по её названию. Режимы «По названию» и «Категории», превью и
// статус живут на самом листе (WhereSheet), здесь только сам выбор сайта.
// Название берётся из item и следует за ним: меняют его - поиск идёт заново.
export default function LogoPickerPanel({ id, item, onChange, onMerchantSelect, apiFetch }) {
  const query = (item.companyName || '').slice(0, 120);
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

  const applyWebsite = () => {
    const domain = normalizeMerchantDomain(website);
    if (!domain) { setWebsiteError('Укажите сайт компании, например company.com'); return; }
    onChange({ logoMode: 'domain', merchantDomain: domain });
  };
  const selectMerchant = merchant => {
    setWebsite(merchant.domain);
    setWebsiteError('');
    if (onMerchantSelect) onMerchantSelect(merchant);
    else onChange({ logoMode: 'domain', merchantDomain: merchant.domain });
  };
  const currentSearch = search.query === query.trim();
  const merchants = currentSearch && search.status === 'ready' ? search.merchants : [];

  return (
    <div id={id} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1-5)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Field aria-label="Сайт компании" value={website} onChange={event => { setWebsite(event.target.value); setWebsiteError(''); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); applyWebsite(); } }} placeholder="company.com" autoComplete="off" autoCapitalize="none" spellCheck={false} aria-invalid={Boolean(websiteError)} aria-describedby={websiteError ? `${id}-error` : undefined} style={{ flex: 1, minWidth: 0, minHeight: '48px' }} />
          <Button tone="soft" size="sm" onClick={applyWebsite} style={{ flexShrink: 0, minHeight: '48px' }}>Применить</Button>
        </div>
        {websiteError && <p id={`${id}-error`} role="alert" style={{ ...HINT_STYLE, color: 'var(--color-negative)' }}>{websiteError}</p>}
      </div>

      <div aria-live="polite" style={HINT_STYLE}>
        {query.trim().length < 2 ? 'Введите хотя бы 2 символа'
          : !currentSearch || search.status === 'idle' || search.status === 'loading' ? <ListSkeleton label="Ищем компании…" rows={2} amounts={false} />
            : search.status === 'error' ? 'Каталог сейчас недоступен. Можно указать сайт вручную.'
              : search.status === 'rate-limit' ? 'Много запросов. Попробуйте через минуту или укажите сайт.'
                : search.status === 'ready' && merchants.length === 0 ? 'Ничего не найдено. Попробуйте другое написание или укажите сайт.' : null}
      </div>
      {merchants.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <span style={SECTION_LABEL_STYLE}>Похожие в каталоге</span>
          <p style={HINT_STYLE}>Сверьте название и сайт: у компаний бывают одинаковые имена.</p>
          <ul aria-label="Найденные компании" style={{ margin: 0, padding: 0, listStyle: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            {merchants.map((merchant, index) => (
              <li key={merchant.domain}>
                <ListRow
                  leading={<TransactionIcon item={{ ...item, logoMode: 'domain', merchantDomain: merchant.domain }} size={32} />}
                  title={merchant.name}
                  subtitle={merchant.domain}
                  trailing={mode === 'domain' && item.merchantDomain === merchant.domain ? <Check size={20} strokeWidth={2.4} role="img" aria-label="Выбрано" color="var(--color-primary)" /> : undefined}
                  divider={index < merchants.length - 1}
                  onClick={() => selectMerchant(merchant)}
                  style={{ padding: 'var(--space-2) var(--space-3)' }}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
