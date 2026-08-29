const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    amount: {
        type: Number,
        required: true
    },
    type: {
        type: String,
        enum: ['income', 'expense', 'initial', 'transfer'],
        required: true
    },
    category: {
        type: String,
        required: function() {
            return this.type !== 'transfer';
        }
    },
    description: {
        type: String,
        trim: true
    },
    account: {
        type: String,
        default: 'card'
    },
    toAccount: {
        type: String
    },
    date: {
        type: Date,
        default: Date.now
    },
    splitId: {
        type: String,
        trim: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    excludeFromStats: {
        type: Boolean,
        default: false
    }
});

// Индексы заведены под те запросы, которые сервер действительно выполняет,
// а не «на всякий случай»: каждый индекс - это плата за запись и место в
// памяти, поэтому лишних тут быть не должно.
//
// Коллекция растёт линейно и навсегда - это единственная коллекция в базе,
// которая не имеет естественного потолка, - так что без индексов каждый из
// перечисленных запросов со временем превращается в полный перебор.

// Список операций: find().sort({ date: -1 }) в GET /api/transactions, он же
// с фильтром по периоду. Направление в индексе совпадает с направлением
// сортировки, так что сортировка берётся из индекса, а не выполняется в
// памяти после выборки.
TransactionSchema.index({ date: -1 });

// Переименование категории переписывает все операции с прежним именем:
// updateMany({ type, category }) в PUT /api/categories/:id. Префикс этого
// же индекса (type) обслуживает поиск стартового баланса при старте
// сервера - findOne({ type: 'initial' }).
TransactionSchema.index({ type: 1, category: 1 });

// Проверка перед удалением счёта: countDocuments({ $or: [{ account },
// { toAccount }] }). У $or каждая ветвь берёт свой индекс, поэтому нужны оба
// - с одним только account запрос всё равно свёлся бы к полному перебору.
// toAccount есть лишь у переводов, splitId - только у разделённых операций,
// поэтому оба индекса разреженные: документы без этих полей в них не
// попадают.
TransactionSchema.index({ account: 1 });
TransactionSchema.index({ toAccount: 1 }, { sparse: true });

// Удаление всей группы разделённой операции: deleteMany({ splitId }).
TransactionSchema.index({ splitId: 1 }, { sparse: true });

module.exports = mongoose.model('Transaction', TransactionSchema);
