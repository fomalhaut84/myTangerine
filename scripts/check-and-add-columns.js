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

async function main() {
  try {
    // 스프레드시트 찾기
    const response = await sheets.spreadsheets.get({
      spreadsheetId: '1234', // 임시 ID로 테스트
    });
  } catch (error) {
    // 실제 스프레드시트 ID를 찾기 위해 Drive API 사용
    const drive = google.drive({ version: 'v3', auth });
    const driveResponse = await drive.files.list({
      q: "name='감귤 주문서(응답)' and mimeType='application/vnd.google-apps.spreadsheet'",
      fields: 'files(id, name)',
    });

    if (!driveResponse.data.files || driveResponse.data.files.length === 0) {
      console.error('스프레드시트를 찾을 수 없습니다.');
      return;
    }

    const spreadsheetId = driveResponse.data.files[0].id;
    console.log('스프레드시트 ID:', spreadsheetId);

    // 첫 번째 시트 이름 가져오기
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetName = spreadsheet.data.sheets[0].properties.title;
    console.log('시트 이름:', sheetName);

    // 헤더 가져오기
    const valuesResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!1:1`,
    });

    const headers = valuesResponse.data.values[0];
    console.log('\n현재 헤더:');
    headers.forEach((h, i) => console.log(`  ${i + 1}. ${h}`));
    console.log('\n총 헤더 개수:', headers.length);

    // DB_SYNC_* 컬럼이 있는지 확인
    const hasDbSyncStatus = headers.includes('DB_SYNC_STATUS');
    const hasDbSyncAt = headers.includes('DB_SYNC_AT');
    const hasDbSyncId = headers.includes('DB_SYNC_ID');

    console.log('\nDB 싱크 컬럼 존재 여부:');
    console.log('  DB_SYNC_STATUS:', hasDbSyncStatus);
    console.log('  DB_SYNC_AT:', hasDbSyncAt);
    console.log('  DB_SYNC_ID:', hasDbSyncId);

    // 컬럼이 없으면 추가
    if (!hasDbSyncStatus || !hasDbSyncAt || !hasDbSyncId) {
      console.log('\n컬럼 추가 중...');

      const newHeaders = [...headers];
      if (!hasDbSyncStatus) newHeaders.push('DB_SYNC_STATUS');
      if (!hasDbSyncAt) newHeaders.push('DB_SYNC_AT');
      if (!hasDbSyncId) newHeaders.push('DB_SYNC_ID');

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetName}'!1:1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [newHeaders],
        },
      });

      console.log('✅ 컬럼 추가 완료!');
      console.log('\n업데이트된 헤더:');
      newHeaders.forEach((h, i) => console.log(`  ${i + 1}. ${h}`));
    } else {
      console.log('\n✅ 모든 DB 싱크 컬럼이 이미 존재합니다.');
    }
  }
}

main().catch(console.error);
