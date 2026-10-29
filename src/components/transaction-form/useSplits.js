import { useRef, useState } from 'react';

// Состояние разделения суммы по категориям. Живёт в родителе, а не в
// SplitEditor: форме нужны остаток и признак «всё заполнено» для блокировки
// сохранения и сами части для отправки.
export default function useSplits(total) {
    const [splits, setSplits] = useState([{ id: 1, amount: '', category: '' }, { id: 2, amount: '', category: '' }]);
    // id для частей из replace: Date.now() у add повторился бы в одной миллисекунде
    const nextId = useRef(3);

    const distributed = splits.reduce((sum, split) => sum + (parseFloat(split.amount) || 0), 0);
    const totalValue = parseFloat(total) || 0;
    const remaining = totalValue - distributed;

    return {
        splits,
        total: totalValue,
        remaining,
        // Копейки float: сравниваем с допуском, а не с нулём
        isBalanced: Math.abs(remaining) < 0.01,
        isComplete: splits.every(s => s.amount && s.category),
        add: () => setSplits([...splits, { id: Date.now(), amount: '', category: '' }]),
        // Меньше двух частей - это уже не разделение
        remove: id => { if (splits.length > 2) setSplits(splits.filter(s => s.id !== id)); },
        update: (id, field, value) => setSplits(splits.map(s => s.id === id ? { ...s, [field]: value } : s)),
        // Части из черновика ({ category, amount }). Поле суммы - number, ему
        // нужна точка, а не запятая, как в поле суммы операции; 8.1 -> «8.10».
        replace: parts => setSplits(parts.map(part => ({ id: nextId.current++, amount: Number(part.amount).toFixed(2), category: part.category }))),
        // Вернуть слепок, снятый раньше (`splits` целиком, с id)
        restore: snapshot => setSplits(snapshot),
    };
}
