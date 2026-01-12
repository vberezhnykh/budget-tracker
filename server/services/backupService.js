const cron = require('node-cron');
const excel = require('exceljs');
const nodemailer = require('nodemailer');
const Transaction = require('../models/Transaction');

// Configure email transporter
const transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

async function generateAndSendBackup() {
    console.log('Starting weekly backup process...');

    try {
        // 1. Fetch data
        const transactions = await Transaction.find().sort({ date: -1 });
        if (transactions.length === 0) {
            console.log('No transactions to backup.');
            return;
        }

        // 2. Create Excel
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet('Transactions');

        worksheet.columns = [
            { header: 'Date', key: 'date', width: 15 },
            { header: 'Type', key: 'type', width: 10 },
            { header: 'Category', key: 'category', width: 15 },
            { header: 'Title', key: 'title', width: 20 },
            { header: 'Amount', key: 'amount', width: 15 },
            { header: 'Account', key: 'account', width: 10 },
            { header: 'Description', key: 'description', width: 30 }
        ];

        transactions.forEach(t => {
            worksheet.addRow({
                date: t.date ? new Date(t.date).toLocaleDateString() : '',
                type: t.type === 'expense' ? 'Расход' : t.type === 'income' ? 'Доход' : 'Перевод',
                category: t.category,
                title: t.title,
                amount: t.amount,
                account: t.account,
                description: t.description || ''
            });
        });

        // Generate buffer
        const buffer = await workbook.xlsx.writeBuffer();

        // 3. Send Email
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_TO,
            subject: `Backup Budget Tracker - ${new Date().toLocaleDateString()}`,
            text: 'Attached is the weekly backup of your transactions.',
            attachments: [
                {
                    filename: `budget_backup_${new Date().toISOString().split('T')[0]}.xlsx`,
                    content: buffer,
                    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                }
            ]
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Backup sent successfully:', info.response);

    } catch (error) {
        console.error('Backup failed:', error);
    }
}

// Schedule: Every Monday at 08:00 AM
const startBackupService = () => {
    // Cron expression: minute hour day-of-month month day-of-week
    // 0 8 * * 1 = At 08:00 on Monday
    cron.schedule('0 8 * * 1', () => {
        generateAndSendBackup();
    });

    console.log('Backup service initialized (Runs every Monday at 08:00)');
};

module.exports = { startBackupService, generateAndSendBackup };
