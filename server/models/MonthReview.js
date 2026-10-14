const mongoose = require('mongoose');

// «Разбор месяца»: готовый текст про законченный месяц. Хранится затем, чтобы
// Claude писал его один раз за месяц, а не при каждом открытии Обзора: пока
// факты месяца (factsHash) не изменились, возвращается сохранённое. Это кэш, а
// не данные пользователя: удалив коллекцию, ничего не потеряешь, разбор
// напишется заново. Поэтому в бэкап она не входит.
const MonthReviewSchema = new mongoose.Schema({
    // 'YYYY-MM'; на месяц один разбор.
    month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    // sha256 стабильной записи фактов, по которым написан текст.
    factsHash: { type: String, required: true },
    review: {
        headline: { type: String, required: true },
        points: [{
            _id: false,
            text: { type: String, required: true },
            // Точное имя категории расходов (для ссылки в Историю) или null.
            category: { type: String, default: null }
        }]
    },
    model: { type: String, required: true },
    // Сколько запросов к Claude ушло на текст: 1 или 2 (повтор после чисел вне фактов).
    attempts: { type: Number, required: true },
    generatedAt: { type: Date, required: true }
}, { versionKey: false });

MonthReviewSchema.index({ month: 1 }, { unique: true });

module.exports = mongoose.model('MonthReview', MonthReviewSchema);
