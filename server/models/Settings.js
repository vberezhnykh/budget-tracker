const mongoose = require('mongoose');

const SETTINGS_SINGLETON_KEY = 'global';

// A single shared document holding app-wide settings (currently just the
// monthly spending limit shown on the stats panel). There is intentionally
// no per-user scoping - this app has one shared household budget, mirroring
// how Account/Category are also global rather than per-user.
const SettingsSchema = new mongoose.Schema({
    // Intentionally no default: old documents must remain visibly legacy
    // until settingsSingleton adopts the only document. A default here
    // would make hydration hide a conflicting set of multiple legacy rows.
    singletonKey: {
        type: String,
        enum: [SETTINGS_SINGLETON_KEY]
    },
    monthlyLimit: {
        type: Number,
        default: 7000,
        // Must be a finite, strictly positive number - mirrors the
        // Number.isFinite/> 0 check in the PUT /api/settings route, but
        // enforced at the model layer too so no write path (present or
        // future) can persist 0, a negative value, NaN, or Infinity (e.g.
        // from JSON like `1e999`, which parses to Infinity and would
        // otherwise render as "Infinity%" on the frontend's limit bar).
        validate: {
            validator: (v) => Number.isFinite(v) && v > 0,
            message: 'monthlyLimit must be a finite number greater than 0'
        }
    }
});

// The partial index permits legacy documents without singletonKey to be
// inspected and adopted, while making creation of the canonical row atomic.
SettingsSchema.index(
    { singletonKey: 1 },
    {
        unique: true,
        name: 'settings_singleton',
        partialFilterExpression: { singletonKey: SETTINGS_SINGLETON_KEY }
    }
);

const Settings = mongoose.model('Settings', SettingsSchema);
Settings.SETTINGS_SINGLETON_KEY = SETTINGS_SINGLETON_KEY;

module.exports = Settings;
