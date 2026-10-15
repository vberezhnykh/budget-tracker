const mongoose = require('mongoose');

// «Разовая чистка старых описаний»: один документ на один прогон. Хранит ход
// (пакет у Claude, готовые предложения, применено, отменено) и резервную копию
// изменённых операций, по которой применение можно отменить до undoUntil.
// Одновременно живёт один прогон в статусе submitted или ready.
const ProposalSchema = new mongoose.Schema({
    // NFKC, нижний регистр, лишние пробелы свёрнуты (normalizedName компании).
    key: { type: String, required: true },
    // Самое частое написание и до пяти разных написаний.
    text: { type: String, required: true },
    variants: [String],
    count: { type: Number, required: true },
    total: { type: Number, required: true },
    categories: [String],
    // skip - Claude не ответил на этот текст; пока пакет не вернулся, у его
    // текстов kind skip и reason 'pending'.
    kind: { type: String, enum: ['existing', 'new', 'note', 'skip'], required: true },
    company: { type: String, default: null },
    note: { type: String, default: null },
    source: { type: String, enum: ['exact', 'claude'], required: true },
    reason: { type: String, default: null }
}, { _id: false });

const DescriptionCleanupSchema = new mongoose.Schema({
    status: { type: String, enum: ['submitted', 'ready', 'applied', 'reverted', 'failed'], required: true },
    batchId: { type: String, default: null },
    model: { type: String, required: true },
    chunks: [{ _id: false, customId: { type: String, required: true }, keys: [String] }],
    proposals: [ProposalSchema],
    createdAt: { type: Date, required: true },
    readyAt: Date,
    appliedAt: Date,
    undoUntil: Date,
    // Поля до и после по каждой изменённой операции. Строка - значение, null -
    // «поля нет». companyId хранится строкой. Mixed: набор полей у операций разный.
    backup: [{
        _id: false,
        txId: { type: mongoose.Schema.Types.ObjectId, required: true },
        before: { type: mongoose.Schema.Types.Mixed, required: true },
        after: { type: mongoose.Schema.Types.Mixed, required: true }
    }],
    // После срока отмены копия стирается; флаг остаётся, чтобы показать «отмена недоступна».
    undoExpired: { type: Boolean, default: false },
    createdCompanyIds: [mongoose.Schema.Types.ObjectId],
    revertedAt: Date,
    // Числа прогона без текстов: сколько текстов, сколько точных, токены, итоги применения.
    stats: { type: mongoose.Schema.Types.Mixed, default: {} },
    failReason: { type: String, default: null }
}, { versionKey: false });

DescriptionCleanupSchema.index({ createdAt: -1 });

module.exports = mongoose.model('DescriptionCleanup', DescriptionCleanupSchema);
