// Загрузчик: читает окружение из server/.env, поднимает подключение к базе,
// сеет пустую базу и только потом начинает слушать порт. Само приложение - в
// server/app.js, засев - в server/seed.js; импорт этого файла ничего не запускает.

const dotenv = require('dotenv');
const {
    closeHttpServer,
    loadServerEnv,
    parsePort,
    startAfterDependencies
} = require('./boot');

let mongoose;
let app;
let seedDefaults;
let logStartupConfigStatus;
let PORT;
let isProduction;
let authDisabled;
let dbOptions;
let configLoaded = false;
let httpServer = null;
let selfPingTimer = null;
let shuttingDown = false;

function loadConfig() {
    if (configLoaded) return;

    // dotenv must run before app/auth are loaded: app.js reads NODE_ENV and
    // AUTH_DISABLED while defining its middleware.
    loadServerEnv(dotenv, __dirname);
    mongoose = require('mongoose');
    app = require('./app');
    ({ seedDefaults } = require('./seed'));
    ({ logStartupConfigStatus } = require('./auth'));
    PORT = parsePort(process.env.PORT);
    isProduction = process.env.NODE_ENV === 'production';
    authDisabled = process.env.AUTH_DISABLED === 'true';
    dbOptions = !isProduction ? { dbName: 'budget-tracker-dev' } : {};
    configLoaded = true;
}

function listen() {
    if (!app) throw new Error('Приложение ещё не загружено');
    return new Promise((resolve, reject) => {
        const server = app.listen(PORT, () => {
            server.removeListener('error', reject);
            resolve(server);
        });
        server.once('error', reject);
    });
}

function startSelfPing() {
    const url = process.env.RENDER_EXTERNAL_URL;
    if (!url) return;

    console.log(`Setting up self-ping for ${url}`);
    selfPingTimer = setInterval(() => {
        fetch(`${url}/api/health`)
            .then(res => {
                if (res.ok) console.log('Self-ping successful');
                else console.error('Self-ping returned error status');
            })
            .catch(err => console.error('Self-ping failed:', err.message));
    }, 14 * 60 * 1000);
    selfPingTimer.unref?.();
}

async function startServer() {
    loadConfig();
    logStartupConfigStatus(isProduction, authDisabled);
    httpServer = await startAfterDependencies({
        connect: async () => {
            if (!process.env.MONGODB_URI) throw new Error('Не задан MONGODB_URI.');
            await mongoose.connect(process.env.MONGODB_URI, dbOptions);
            console.log(`MongoDB Connected (${isProduction ? 'Production' : 'Development: budget-tracker-dev'})`);
        },
        seed: seedDefaults,
        listen,
        isCancelled: () => shuttingDown,
        onCancelled: () => mongoose.disconnect()
    });

    console.log(`Server running on port ${PORT}`);
    startSelfPing();
    return httpServer;
}

async function shutdown(signal = null) {
    if (shuttingDown) return;
    shuttingDown = true;
    if (selfPingTimer) clearInterval(selfPingTimer);

    try {
        await closeHttpServer(httpServer);
    } catch (error) {
        console.error('Не удалось закрыть HTTP-сервер:', error.message);
        process.exitCode = 1;
    } finally {
        httpServer = null;
    }

    try {
        if (mongoose) await mongoose.disconnect();
    } catch (error) {
        console.error('Не удалось закрыть MongoDB:', error.message);
        process.exitCode = 1;
    }

    if (signal) console.log(`Получен ${signal}, сервер остановлен.`);
}

async function main() {
    try {
        await startServer();
    } catch (error) {
        console.error('Не удалось запустить сервер:', error.message);
        process.exitCode = 1;
        await shutdown();
    }
}

if (require.main === module) {
    process.once('SIGINT', () => { shutdown('SIGINT'); });
    process.once('SIGTERM', () => { shutdown('SIGTERM'); });
    main();
}

module.exports = { main, listen, startServer, shutdown };
