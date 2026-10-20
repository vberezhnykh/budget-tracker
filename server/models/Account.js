const mongoose = require('mongoose');
const { ledgerInvalidationPlugin } = require('../ledgerCachePlugin');

const AccountSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        unique: true
    },
    type: {
        type: String,
        enum: ['card', 'cash'],
        required: true
    },
    icon: {
        type: String,
        default: '💳'
    },
    isDefault: {
        type: Boolean,
        default: false
    },
    // Счёт, деньги на котором есть, но потратить их нельзя: залог у
    // арендодателя, срочный вклад. В общий капитал такие не входят - иначе
    // цифра "сколько у меня есть" обещает больше, чем доступно на руках.
    excludeFromTotal: {
        type: Boolean,
        default: false
    },
    order: {
        type: Number,
        default: 0
    }
});

// Любая запись сбрасывает кэш операций и счетов в памяти сервера (см.
// server/ledgerCache.js); хук на схеме, а не вызовы в роутах - чтобы ни одна
// запись, откуда бы она ни пришла, не осталась незамеченной.
AccountSchema.plugin(ledgerInvalidationPlugin);

module.exports = mongoose.model('Account', AccountSchema);
