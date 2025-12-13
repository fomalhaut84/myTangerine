const { SheetService } = require('../packages/core/dist/services/sheet-service');
const { google } = require('googleapis');
const fs = require('fs');

const credentials = JSON.parse(fs.readFileSync('./credentials.json', 'utf8'));
const auth = new google.auth.JWT(
  credentials.client_email,
  null,
  credentials.private_key,
  ['https://www.googleapis.com/auth/spreadsheets']
);

const sheets = google.sheets({ version: 'v4', auth });
const service = new SheetService(sheets);

(async () => {
  try {
    const headers = await service.getHeaders();
    console.log('현재 헤더:', headers);
    console.log('\n헤더 개수:', headers.length);
  } catch (error) {
    console.error('Error:', error.message);
  }
})();
