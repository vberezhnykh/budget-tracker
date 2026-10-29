const mongoose = require('mongoose');
const { ledgerInvalidationPlugin } = require('../ledgerCachePlugin');

const CategorySchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    type: {
        type: String,
        enum: ['expense', 'income'],
        required: true
    },
    order: {
        type: Number,
        default: 0
    }
});

// Ensure unique category name per type
CategorySchema.index({ name: 1, type: 1 }, { unique: true });

// Категории лежат в снимке кэша сервера рядом со счетами (см. server/ledgerCache.js):
// любая запись сбрасывает его, чтобы список не отставал от базы.
CategorySchema.plugin(ledgerInvalidationPlugin);

module.exports = mongoose.model('Category', CategorySchema);
