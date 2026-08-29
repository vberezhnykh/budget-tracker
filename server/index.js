// Загрузчик: читает окружение, поднимает подключение к базе, сеет пустую и
// начинает слушать порт. Само приложение - в server/app.js, засев - в
// server/seed.js; здесь только то, что имеет смысл ровно один раз за жизнь
// процесса и чего не должно происходить при импорте сервера в тест.
//
// dotenv обязан отработать до require('./app'): app.js читает NODE_ENV и
// AUTH_DISABLED на верхнем уровне модуля, и если .env ещё не загружен, он
// увидит пустые значения.
require('dotenv').config();

const mongoose = require('mongoose');
const app = require('./app');
const { seedDefaults } = require('./seed');
const { logStartupConfigStatus } = require('./auth');

const PORT = process.env.PORT || 5000;
const isProduction = process.env.NODE_ENV === 'production';
const authDisabled = process.env.AUTH_DISABLED === 'true';

logStartupConfigStatus(isProduction, authDisabled);

// Database Connection
const dbOptions = !isProduction ? { dbName: 'budget-tracker-dev' } : {};

mongoose.connect(process.env.MONGODB_URI, dbOptions)
    .then(async () => {
        console.log(`MongoDB Connected (${isProduction ? 'Production' : 'Development: budget-tracker-dev'})`);
        await seedDefaults();
    })
    .catch(err => console.log(err));

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);

    // Prevention of Render's "Sleep" mode
    const url = process.env.RENDER_EXTERNAL_URL;
    if (url) {
        console.log(`Setting up self-ping for ${url}`);
        setInterval(() => {
            fetch(`${url}/api/health`)
                .then(res => {
                    if (res.ok) console.log('Self-ping successful');
                    else console.error('Self-ping returned error status');
                })
                .catch(err => console.error('Self-ping failed:', err.message));
        }, 14 * 60 * 1000); // Every 14 minutes
    }
});
