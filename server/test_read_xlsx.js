const xlsx = require('xlsx');
const path = require('path');

const filename = path.join(__dirname, 'budget_backup_2026-03-30.xlsx');

try {
    const workbook = xlsx.readFile(filename);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const json = xlsx.utils.sheet_to_json(sheet, { header: 1 });
    
    console.log("HEADERS:", json[0]);
    console.log("FIRST ROW:", json[1]);
} catch (e) {
    console.error("Error reading file:", e.message);
}
