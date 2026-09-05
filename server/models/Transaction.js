const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    amount: {
        type: Number,
        required: true,
        validate: {
            validator(value) {
                if (!Number.isFinite(value) || value === 0) return false;

                // Отрицательный initial - допустимый начальный долг. На
                // обычном документе type известен; при query update без
                // type окончательное состояние проверяет route validator.
                if (typeof this.getUpdate === 'function') {
                    const update = this.getUpdate();
                    const type = update?.$set?.type ?? update?.type;
                    return type === undefined || type === 'initial' || value > 0;
                }
                return this.type === 'initial' || value > 0;
            },
            message: 'amount must be finite and non-zero; only initial may be negative'
        }
    },
    type: {
        type: String,
        enum: ['income', 'expense', 'initial', 'transfer'],
        required: true
    },
    category: {
        type: String,
        trim: true,
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
        required: true,
        trim: true,
        default: 'card'
    },
    toAccount: {
        type: String,
        trim: true,
        required: function() {
            return this.type === 'transfer';
        },
        validate: {
            validator(value) {
                if (this.type !== 'transfer') return true;
                return Boolean(value) && value !== this.account;
            },
            message: 'transfer destination must differ from source account'
        }
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
    },
    deletedAt: {
        type: Date
    },
    deletionBatchId: {
        type: String,
        trim: true
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
TransactionSchema.index({ deletedAt: 1, date: -1 });

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
TransactionSchema.index({ deletionBatchId: 1 }, { sparse: true });

module.exports = mongoose.model('Transaction', TransactionSchema);
