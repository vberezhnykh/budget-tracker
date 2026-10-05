import { useEffect, useMemo, useState } from 'react';
import { getDescriptionSuggestions } from '../../utils/finance';

const EMPTY_SUGGESTIONS = [];

// Подсказки для поля комментария: то, что уже писалось для выбранной
// категории. Есть apiFetch - берём с сервера (там история целиком), нет -
// считаем по переданным операциям. `category` пустая - подсказывать нечего
// (в режиме разделения одно описание относится сразу к нескольким
// категориям). Возвращает то, что стоит показать при текущем тексте.
export default function useDescriptionSuggestions({ transactions, category, type, apiFetch, typedText }) {
    const local = useMemo(
        () => getDescriptionSuggestions(transactions, category, type),
        [transactions, category, type]
    );

    const [remote, setRemote] = useState(null);
    // Ответ привязан к ключу: после смены категории или типа он устаревает
    // сразу, не дожидаясь нового запроса
    const key = `${type}:${category}`;
    useEffect(() => {
        if (!apiFetch || !category) return;
        let current = true;
        const controller = new AbortController();
        const params = new URLSearchParams({ category, type });
        apiFetch(`/api/suggestions/descriptions?${params}`, { signal: controller.signal })
            .then(async response => {
                if (!response.ok) throw new Error();
                const values = await response.json();
                if (current && Array.isArray(values) && values.every(value => typeof value === 'string')) setRemote({ key, values });
            }).catch(() => {});
        return () => { current = false; controller.abort(); };
    }, [apiFetch, category, key, type]);
    const all = apiFetch
        ? (remote?.key === key ? remote.values : EMPTY_SUGGESTIONS)
        : local;

    // Пока поле пустое - показываем весь топ; как только пользователь начал
    // печатать, подсказки сужаются до подходящих, а точное совпадение
    // (уже выбранная подсказка) убирается - нажимать на него нечего.
    return useMemo(() => {
        const typed = (typedText || '').trim().toLowerCase();
        if (!typed) return all;
        return all.filter(s => {
            const lower = s.toLowerCase();
            return lower !== typed && lower.includes(typed);
        });
    }, [all, typedText]);
}
