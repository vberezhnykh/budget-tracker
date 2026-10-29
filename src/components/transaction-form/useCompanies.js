import { useEffect, useMemo, useState } from 'react';
import { getCompanySuggestions } from '../../utils/companies';

// Компании для строки «Где» и листа выбора: общий список с сервера и
// подсказки под категорию и набранный текст. Живёт в форме, а не в строке или
// листе: им нужны одни и те же данные, и лист открывается поверх уже
// загруженного списка.
//
// enabled - компании нужны только расходу. historyWanted - есть смысл
// спрашивать историю (выбрана категория или открыт лист). query - набранный в
// листе текст; в строке он пустой, и подсказки идут только по категории.
// Без apiFetch (простые вызывающие) история берётся из переданных операций.
export default function useCompanies({ enabled, apiFetch, transactions, category = '', query = '', historyWanted }) {
    const [companies, setCompanies] = useState([]);
    const [status, setStatus] = useState('loading');
    const [retry, setRetry] = useState(0);
    const [history, setHistory] = useState(null);
    const request = apiFetch || fetch;

    useEffect(() => {
        if (!enabled) return;
        let current = true;
        const controller = new AbortController();
        Promise.resolve().then(() => request('/api/companies', { signal: controller.signal })).then(async response => {
            if (!response.ok) throw new Error('unavailable');
            const body = await response.json();
            if (!Array.isArray(body)) throw new Error('unavailable');
            if (current) { setCompanies(body); setStatus('ready'); }
        }).catch(() => { if (current) setStatus('error'); });
        return () => { current = false; controller.abort(); };
    }, [enabled, request, retry]);

    // История с сервера целиком (локальные операции - только загруженный
    // кусок), поэтому после паузы в наборе просим её под текст и категорию.
    useEffect(() => {
        if (!apiFetch || !enabled || !historyWanted) return;
        let current = true;
        const controller = new AbortController();
        const timer = setTimeout(() => {
            request(`/api/companies/history?${new URLSearchParams({ q: query, category })}`, { signal: controller.signal })
                .then(async response => {
                    if (!response.ok) throw new Error();
                    const values = await response.json();
                    if (current && Array.isArray(values)) setHistory({ query, category, values });
                }).catch(() => {});
        }, 250);
        return () => { current = false; clearTimeout(timer); controller.abort(); };
    }, [apiFetch, enabled, historyWanted, request, query, category]);

    // Ответ привязан к запросу: после смены текста или категории он устаревает
    // сразу, а до нового ответа работаем по локальным операциям.
    const historyTransactions = history?.query === query && history.category === category ? history.values : transactions;
    const suggestions = useMemo(
        () => getCompanySuggestions(companies, historyTransactions, query, category),
        [companies, historyTransactions, query, category]
    );

    return {
        companies,
        status,
        suggestions,
        historyTransactions,
        reload: () => { setStatus('loading'); setRetry(value => value + 1); },
    };
}
