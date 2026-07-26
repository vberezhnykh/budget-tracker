const mongoose = require('mongoose');

// A single shared document holding app-wide settings (currently just the
// monthly spending limit shown on the stats panel). There is intentionally
// no per-user scoping - this app has one shared household budget, mirroring
// how Account/Category are also global rather than per-user.
const SettingsSchema = new mongoose.Schema({
    monthlyLimit: {
        type: Number,
        default: 7000
    }
});

module.exports = mongoose.model('Settings', SettingsSchema);
