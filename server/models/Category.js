const mongoose = require('mongoose');

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

module.exports = mongoose.model('Category', CategorySchema);
