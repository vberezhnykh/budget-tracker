import { useState } from 'react';

// Состояние разделения суммы по категориям. Живёт в родителе, а не в
// SplitEditor: форме нужны остаток и признак «всё заполнено» для блокировки
// сохранения и сами части для отправки.
export default function useSplits(total) {
    const [splits, setSplits] = useState([{ id: 1, amount: '', category: '' }, { id: 2, amount: '', category: '' }]);

    const distributed = splits.reduce((sum, split) => sum + (parseFloat(split.amount) || 0), 0);
    const remaining = (parseFloat(total) || 0) - distributed;

    return {
        splits,
        remaining,
        // Копейки float: сравниваем с допуском, а не с нулём
        isBalanced: Math.abs(remaining) < 0.01,
        isComplete: splits.every(s => s.amount && s.category),
        add: () => setSplits([...splits, { id: Date.now(), amount: '', category: '' }]),
        // Меньше двух частей - это уже не разделение
        remove: id => { if (splits.length > 2) setSplits(splits.filter(s => s.id !== id)); },
        update: (id, field, value) => setSplits(splits.map(s => s.id === id ? { ...s, [field]: value } : s)),
    };
}
