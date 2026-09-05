const path = require('path');

const DEFAULT_PORT = 5000;

function serverEnvPath(dirname = __dirname) {
    return path.join(dirname, '.env');
}

function loadServerEnv(dotenv, dirname = __dirname) {
    return dotenv.config({ path: serverEnvPath(dirname) });
}

function parsePort(value = DEFAULT_PORT) {
    const port = Number(value || DEFAULT_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`PORT должен быть целым числом от 1 до 65535 (получено: ${value})`);
    }
    return port;
}

// Dependencies must become ready before listen is called. Keeping this small
// and injected makes the ordering testable without opening a real socket or
// connecting to a database.
const START_CANCELLED = 'Запуск отменён до открытия HTTP-порта';

async function startAfterDependencies({ connect, seed, listen, isCancelled = () => false, closeServer = closeHttpServer, onCancelled = async () => {} }) {
    await connect();
    if (isCancelled()) {
        await onCancelled();
        throw new Error(START_CANCELLED);
    }
    await seed();
    if (isCancelled()) {
        await onCancelled();
        throw new Error(START_CANCELLED);
    }
    const server = await listen();
    if (isCancelled()) {
        await closeServer(server);
        await onCancelled();
        throw new Error(START_CANCELLED);
    }
    return server;
}

function closeHttpServer(server, { timeoutMs = 10_000 } = {}) {
    if (!server) return Promise.resolve();
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error = null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (error) reject(error);
            else resolve();
        };
        const timer = setTimeout(() => {
            // A long-lived request must not keep shutdown pending forever.
            // Node's method closes active connections while preserving the
            // normal close callback for the server itself.
            try { server.closeAllConnections?.(); } catch { /* best effort */ }
            finish(new Error('Превышен срок закрытия HTTP-сервера'));
        }, timeoutMs);
        server.close(error => finish(error));
    });
}

module.exports = {
    DEFAULT_PORT,
    serverEnvPath,
    loadServerEnv,
    parsePort,
    START_CANCELLED,
    startAfterDependencies,
    closeHttpServer
};
