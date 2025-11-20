import { google, sheets_v4 } from 'googleapis';
import { JWT } from 'google-auth-library';
import type { Config } from '../config/config.js';
import type { SheetRow, Order } from '../types/order.js';
import fs from 'fs';

/**
 * Google Sheets 서비스
 */
export class SheetService {
  private sheets: sheets_v4.Sheets | null = null;
  private spreadsheetId: string | null = null;
  private lastRowIndex: number | null = null;

  constructor(private readonly config: Config) {}

  /**
   * Google Sheets API 인증
   */
  private async authenticate(): Promise<void> {
    try {
      // credentials.json 파일 읽기
      const credentialsPath = this.config.credentialsPath;
      if (!fs.existsSync(credentialsPath)) {
        throw new Error(
          `인증 파일을 찾을 수 없습니다: ${credentialsPath}\n` +
            `credentials.json.example을 참고하여 credentials.json 파일을 생성하세요.`
        );
      }

      const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));

      // JWT 인증 설정
      const auth = new JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: [
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/drive.readonly',
        ],
      });

      // Google Sheets API 클라이언트 생성
      this.sheets = google.sheets({ version: 'v4', auth });
    } catch (error) {
      throw new Error(`Google Sheets 인증 실패: ${error}`);
    }
  }

  /**
   * 스프레드시트 ID 조회
   */
  private async getSpreadsheetId(): Promise<string> {
    if (this.spreadsheetId) {
      return this.spreadsheetId;
    }

    if (!this.sheets) {
      await this.authenticate();
    }

    // 실제로는 Drive API를 사용하여 이름으로 검색해야 하지만,
    // 간단한 PoC를 위해 환경 변수로 ID를 받도록 수정할 수 있습니다.
    // 여기서는 스프레드시트 이름을 사용하는 것으로 가정합니다.

    throw new Error(
      '스프레드시트 ID를 환경 변수에 추가해주세요.\n' +
        'SPREADSHEET_ID=your_spreadsheet_id'
    );
  }

  /**
   * 모든 행 데이터 가져오기
   */
  async getAllRows(): Promise<SheetRow[]> {
    try {
      if (!this.sheets) {
        await this.authenticate();
      }

      // 환경 변수에서 스프레드시트 ID 가져오기 (임시)
      const spreadsheetId = process.env.SPREADSHEET_ID;
      if (!spreadsheetId) {
        throw new Error('SPREADSHEET_ID 환경 변수가 설정되지 않았습니다.');
      }

      // 시트의 모든 데이터 가져오기
      const response = await this.sheets!.spreadsheets.values.get({
        spreadsheetId,
        range: 'A1:Z1000', // 충분히 큰 범위
      });

      const rows = response.data.values;
      if (!rows || rows.length === 0) {
        return [];
      }

      // 첫 행은 헤더
      const [headers, ...dataRows] = rows;
      this.lastRowIndex = dataRows.length;

      // 객체 배열로 변환
      return dataRows.map((row) => {
        const rowData: any = {};
        headers.forEach((header, index) => {
          rowData[header] = row[index] || '';
        });
        return rowData as SheetRow;
      });
    } catch (error) {
      throw new Error(`스프레드시트 데이터 조회 실패: ${error}`);
    }
  }

  /**
   * 새 주문만 가져오기 (비고가 "확인"이 아닌 것)
   */
  async getNewOrders(): Promise<SheetRow[]> {
    const allRows = await this.getAllRows();
    return allRows.filter((row) => row.비고 !== '확인');
  }

  /**
   * 특정 셀 업데이트
   */
  async updateCell(row: number, column: string, value: string): Promise<void> {
    try {
      if (!this.sheets) {
        await this.authenticate();
      }

      const spreadsheetId = process.env.SPREADSHEET_ID;
      if (!spreadsheetId) {
        throw new Error('SPREADSHEET_ID 환경 변수가 설정되지 않았습니다.');
      }

      const range = `${column}${row}`;
      await this.sheets!.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[value]],
        },
      });
    } catch (error) {
      throw new Error(`셀 업데이트 실패: ${error}`);
    }
  }

  /**
   * 주문을 "확인"으로 표시
   */
  async markAsConfirmed(rowIndex: number): Promise<void> {
    // 비고 컬럼 찾기 (예: K열)
    // 실제로는 헤더에서 동적으로 찾아야 함
    await this.updateCell(rowIndex + 2, 'K', '확인'); // +2는 헤더 행 + 1-based index
  }
}
