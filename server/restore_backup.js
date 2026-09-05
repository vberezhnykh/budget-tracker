const mongoose = require('mongoose');
const xlsx = require('xlsx');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const Transaction = require('./models/Transaction');
const Category = require('./models/Category');

const filename = path.join(__dirname, 'budget_backup_2026-03-30.xlsx');

async function restoreDatabase() {
    try {
        if (!process.env.MONGODB_URI) {
            throw new Error('MONGODB_URI is not defined in .env');
        }

        console.log('⏳ Соединяемся с новым кластером MongoDB Atlas...');
        await mongoose.connect(process.env.MONGODB_URI, { dbName: 'budget-tracker-dev' });
        console.log('✅ Успешно подключено к MongoDB!');

        console.log(`⏳ Читаем файл бэкапа: ${filename}`);
        const workbook = xlsx.readFile(filename, { cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        
        // Читаем все строки
        const json = xlsx.utils.sheet_to_json(sheet);
        console.log(`Найдено ${json.length} записей в бэкапе.`);

        const typeMap = {
            'Доход': 'income',
            'Расход': 'expense',
            'Стартовый баланс': 'initial',
            'Начальный': 'initial',
            'Перевод': 'transfer',
            'income': 'income',
            'expense': 'expense',
            'initial': 'initial',
            'transfer': 'transfer'
        };

        const transactionsToInsert = [];
        const uniqueCategories = new Set();
        const categoryTypeMap = {}; // для добавления категорий

        for (const row of json) {
            // Ищем значения по столбцам с учётом возможных названий
            const rawType = row['Type'] || row['Тип'] || '';
            const mappedType = typeMap[rawType] || 'expense'; 
            
            const category = row['Category'] || row['Категория'] || 'Другое';
            if (mappedType === 'income' || mappedType === 'expense') {
                uniqueCategories.add(category);
                categoryTypeMap[category] = mappedType;
            }

            const rawDate = row['Date'] || row['Дата'];
            // xlsx cellDates:true will parse them as native JS Dates if formatted properly in Excel
            const parsedDate = new Date(rawDate);

            const tx = {
                date: isNaN(parsedDate.getTime()) ? new Date() : parsedDate,
                type: mappedType,
                category: category,
                title: row['Title'] || row['Название'] || category,
                amount: parseFloat(row['Amount'] || row['Сумма'] || 0),
                account: row['Account'] || row['Счет'] || 'card',
                description: row['Description'] || row['Описание'] || ''
            };

            transactionsToInsert.push(tx);
        }

        // 1. Очистка транзакций перед импортом
        console.log('🗑 Удаляем старые транзакции в базе (на всякий случай, если там что-то было)...');
        await Transaction.deleteMany({});
        
        // 2. Вставка транзакций
        console.log(`⏳ Восстанавливаем транзакции (${transactionsToInsert.length} шт.)...`);
        if (transactionsToInsert.length > 0) {
            await Transaction.insertMany(transactionsToInsert);
        }
        console.log(`✅ Выполнено! Загружено ${transactionsToInsert.length} транзакций.`);

        // 3. Восстанавливаем кастомные категории
        console.log('⏳ Проверяем и восстанавливаем категории...');
        const existingCategories = await Category.find();
        const existingCategoryNames = new Set(existingCategories.map(c => c.name));
        
        const categoriesToInsert = [];
        for (const catName of uniqueCategories) {
            if (!existingCategoryNames.has(catName) && catName !== 'Другое') {
                categoriesToInsert.push({
                    name: catName,
                    type: categoryTypeMap[catName],
                    isDefault: false,
                    order: existingCategories.length + categoriesToInsert.length + 1
                });
            }
        }

        if (categoriesToInsert.length > 0) {
            await Category.insertMany(categoriesToInsert);
            console.log(`✅ Добавлено ${categoriesToInsert.length} пользовательских категорий:`, categoriesToInsert.map(c => c.name).join(', '));
        } else {
            console.log('✅ Все категории либо базовые, либо уже в базе.');
        }

        console.log('\n🎉 Восстановление полностью завершено! Теперь вы можете запустить `npm start` и пользоваться приложением.');

    } catch (error) {
        console.error('❌ ПРОИЗОШЛА ОШИБКА:', error);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Соединение с базой закрыто.');
        process.exit(0);
    }
}

restoreDatabase();
