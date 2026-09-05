const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const Transaction = require('./models/Transaction');
const Category = require('./models/Category');

const BACKUP_DIR = path.join(__dirname, 'backup_before_multiaccounts');

async function runBackupForDb(dbName) {
    console.log(`⏳ Попытка резервного копирования для базы данных: ${dbName || 'по умолчанию'}...`);
    
    const options = dbName ? { dbName } : {};
    
    // Подключаемся к MongoDB
    const conn = await mongoose.connect(process.env.MONGODB_URI, options);
    
    // Получаем список коллекций
    const collections = await conn.connection.db.listCollections().toArray();
    console.log(`Найденные коллекции в базе "${dbName || conn.connection.name}":`, collections.map(c => c.name));
    
    const dbBackupDir = path.join(BACKUP_DIR, dbName || conn.connection.name);
    if (!fs.existsSync(dbBackupDir)) {
        fs.mkdirSync(dbBackupDir, { recursive: true });
    }
    
    let totalDocs = 0;
    
    for (const collInfo of collections) {
        const collName = collInfo.name;
        const documents = await conn.connection.db.collection(collName).find({}).toArray();
        
        if (documents.length > 0) {
            const backupFilePath = path.join(dbBackupDir, `${collName}.json`);
            fs.writeFileSync(backupFilePath, JSON.stringify(documents, null, 2), 'utf8');
            console.log(`✅ Коллекция "${collName}": сохранено ${documents.length} документов в ${backupFilePath}`);
            totalDocs += documents.length;
        } else {
            console.log(`ℹ️ Коллекция "${collName}" пуста, пропускаем.`);
        }
    }
    
    await mongoose.disconnect();
    console.log(`🔌 Отключено от базы данных для ${dbName || 'по умолчанию'}. Всего сохранено документов: ${totalDocs}\n`);
    return totalDocs;
}

async function main() {
    try {
        if (!process.env.MONGODB_URI) {
            throw new Error('MONGODB_URI не найден в файле .env');
        }
        
        if (!fs.existsSync(BACKUP_DIR)) {
            fs.mkdirSync(BACKUP_DIR, { recursive: true });
        }
        
        // Резервное копирование для dev-базы
        const docsDev = await runBackupForDb('budget-tracker-dev');
        
        // Резервное копирование для prod/default-базы
        const docsProd = await runBackupForDb(null);
        
        console.log(`🎉 Резервное копирование успешно завершено!`);
        console.log(`Файлы бэкапа сохранены в папке: ${BACKUP_DIR}`);
    } catch (error) {
        console.error('❌ Ошибка резервного копирования:', error);
        process.exit(1);
    }
}

main();
