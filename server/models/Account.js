const mongoose = require('mongoose');

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
    order: {
        type: Number,
        default: 0
    }
});

module.exports = mongoose.model('Account', AccountSchema);
