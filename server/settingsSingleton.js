const Settings = require('./models/Settings');

const { SETTINGS_SINGLETON_KEY } = Settings;

class SettingsIntegrityError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SettingsIntegrityError';
        this.code = 'SETTINGS_INTEGRITY';
    }
}

function integrityMessage(count) {
    return `Обнаружено несколько наборов настроек (${count}). `
        + 'Требуется выбрать актуальный; данные сохранены.';
}

async function ensureSingletonIndex() {
    try {
        // Model.init() caches its promise. Awaiting it here closes the startup
        // race where first requests could upsert before the unique index was
        // ready, while adding no repeated index work after initialization.
        await Settings.init();
    } catch (error) {
        if (error?.code === 11000) {
            throw new SettingsIntegrityError(integrityMessage('с одинаковым ключом'));
        }
        throw error;
    }
}

// Returns the one canonical settings document, adopting exactly one legacy
// document that predates singletonKey. It never selects among multiple rows:
// doing so could silently discard a real monthlyLimit chosen by the owner.
async function getCanonicalSettings() {
    await ensureSingletonIndex();
    const documents = await Settings.find({}).sort({ _id: 1 });
    if (documents.length > 1) {
        throw new SettingsIntegrityError(integrityMessage(documents.length));
    }
    if (documents.length === 0) return null;

    const [only] = documents;
    if (only.singletonKey === SETTINGS_SINGLETON_KEY) return only;
    if (only.singletonKey !== undefined && only.singletonKey !== null) {
        throw new SettingsIntegrityError('Обнаружен неизвестный ключ настроек. Требуется проверить документ; данные сохранены.');
    }

    const adopted = await Settings.findOneAndUpdate(
        {
            _id: only._id,
            $or: [
                { singletonKey: { $exists: false } },
                { singletonKey: null }
            ]
        },
        { $set: { singletonKey: SETTINGS_SINGLETON_KEY } },
        { new: true, runValidators: true }
    );

    // Another request may have adopted the same row after our read.
    if (adopted) return adopted;
    const canonical = await Settings.findOne({ singletonKey: SETTINGS_SINGLETON_KEY });
    if (canonical) return canonical;
    throw new SettingsIntegrityError('Не удалось однозначно принять legacy-настройки. Требуется проверить документ; данные сохранены.');
}

async function saveCanonicalSettings(monthlyLimit) {
    const existing = await getCanonicalSettings();
    if (existing) {
        return Settings.findOneAndUpdate(
            { singletonKey: SETTINGS_SINGLETON_KEY },
            { $set: { monthlyLimit } },
            { new: true, runValidators: true }
        );
    }

    try {
        return await Settings.findOneAndUpdate(
            { singletonKey: SETTINGS_SINGLETON_KEY },
            {
                $set: { monthlyLimit },
                $setOnInsert: { singletonKey: SETTINGS_SINGLETON_KEY }
            },
            { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
        );
    } catch (error) {
        // Concurrent first writers can race between the empty read and the
        // unique upsert. The index chose the canonical row; this request may
        // now apply its value to that same row, preserving last-write-wins.
        if (error?.code !== 11000) throw error;
        return Settings.findOneAndUpdate(
            { singletonKey: SETTINGS_SINGLETON_KEY },
            { $set: { monthlyLimit } },
            { new: true, runValidators: true }
        );
    }
}

module.exports = {
    SettingsIntegrityError,
    getCanonicalSettings,
    saveCanonicalSettings
};
