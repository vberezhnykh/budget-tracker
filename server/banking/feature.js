// A configured provider does not enable the feature by itself.
function isBankingEnabled(env = process.env) {
    return env.BANKING_ENABLED === 'true';
}

module.exports = { isBankingEnabled };
