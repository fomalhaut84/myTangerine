import { google, sheets_v4 } from 'googleapis';
import { JWT } from 'google-auth-library';
import { Config } from '../config/config.js';
import type { SheetRow } from '../types/order.js';

/**
 * Google Sheets API를 사용한 스프레드시트 서비스
 */
export class SheetService {
  private config: Config;
  private sheets: sheets_v4.Sheets;
  private auth: JWT;
  private spreadsheetId: string | null = null;
  private firstSheetName: string | null = null; // 첫 번째 워크시트 이름 캐싱
  private newOrderRows: number[] = []; // 처리할 행들의 실제 인덱스 저장

  constructor(config: Config) {
    this.config = config;
    this.auth = this.setupAuth();
    this.sheets = google.sheets({ version: 'v4', auth: this.auth });
  }

  /**
   * Google 인증 설정
   */
  private setupAuth(): JWT {
    try {
      let credentials: any;

      // 우선순위에 따라 credentials 로드: PATH > FILE > JSON
      if (this.config.credentialsPath) {
        // 파일에서 로드 (우선순위 1)
        const fs = require('fs');
        const credentialsData = fs.readFileSync(this.config.credentialsPath, 'utf8');
        credentials = JSON.parse(credentialsData);
      } else if (this.config.credentialsJson) {
        // JSON 문자열에서 로드 (우선순위 2)
        credentials = JSON.parse(this.config.credentialsJson);
      } else {
        throw new Error('No credentials provided');
      }

      return new google.auth.JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: [
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/drive.readonly',
        ],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to setup Google authentication: ${message}`);
    }
  }

  /**
   * 시트 이름을 A1 notation에 맞게 인용
   * 공백이나 특수문자가 있는 시트명은 작은따옴표로 감싸야 함
   */
  private quoteSheetName(sheetName: string): string {
    // 시트명 내부의 작은따옴표는 두 개로 escape
    const escaped = sheetName.replace(/'/g, "''");
    return `'${escaped}'`;
  }

  /**
   * 첫 번째 워크시트 이름 가져오기
   * Python 버전의 sheet1과 동일한 동작 (첫 번째 시트 사용)
   */
  private async getFirstSheetName(): Promise<string> {
    // 이미 캐시된 이름이 있으면 반환
    if (this.firstSheetName) {
      return this.firstSheetName;
    }

    try {
      const spreadsheetId = await this.getSpreadsheetId();
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId,
      });

      const sheets = response.data.sheets;
      if (!sheets || sheets.length === 0) {
        throw new Error('No sheets found in spreadsheet');
      }

      const firstSheet = sheets[0];
      if (!firstSheet.properties?.title) {
        throw new Error('First sheet has no title');
      }

      this.firstSheetName = firstSheet.properties.title;
      return this.firstSheetName;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get first sheet name: ${message}`);
    }
  }

  /**
   * 스프레드시트 ID 가져오기
   * Config에 ID가 있으면 사용, 없으면 이름으로 찾기
   */
  private async getSpreadsheetId(): Promise<string> {
    // 이미 캐시된 ID가 있으면 반환
    if (this.spreadsheetId) {
      return this.spreadsheetId;
    }

    // Config에 spreadsheetId가 있으면 사용
    if (this.config.spreadsheetId) {
      this.spreadsheetId = this.config.spreadsheetId;
      return this.spreadsheetId;
    }

    // 이름으로 찾기 (Drive API 사용)
    try {
      const drive = google.drive({ version: 'v3', auth: this.auth });
      const response = await drive.files.list({
        q: `name='${this.config.spreadsheetName}' and mimeType='application/vnd.google-apps.spreadsheet'`,
        fields: 'files(id, name)',
        spaces: 'drive',
      });

      const files = response.data.files;
      if (!files || files.length === 0) {
        throw new Error(`Spreadsheet '${this.config.spreadsheetName}' not found`);
      }

      if (!files[0].id) {
        throw new Error(`Spreadsheet ID is undefined`);
      }

      this.spreadsheetId = files[0].id;
      return this.spreadsheetId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to find spreadsheet: ${message}`);
    }
  }

  /**
   * 모든 행 가져오기
   */
  async getAllRows(): Promise<SheetRow[]> {
    try {
      const spreadsheetId = await this.getSpreadsheetId();
      const sheetName = await this.getFirstSheetName();
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId,
        range: this.quoteSheetName(sheetName), // 첫 번째 시트 (Python의 sheet1과 동일)
      });

      const rows = response.data.values;
      if (!rows || rows.length === 0) {
        return [];
      }

      // 첫 번째 행은 헤더
      const headers = rows[0] as string[];
      const dataRows = rows.slice(1);

      // 헤더를 키로 사용하여 객체 배열로 변환
      return dataRows.map((row, index) => {
        const rowData: Record<string, string> = {};
        headers.forEach((header, i) => {
          rowData[header] = row[i] || '';
        });
        // 실제 스프레드시트 행 번호 저장 (헤더 행 + 1, 1-based)
        (rowData as any)._rowNumber = index + 2;
        return rowData as unknown as SheetRow;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get all rows: ${message}`);
    }
  }

  /**
   * 새로운 주문만 가져오기 (Python 버전과 동일한 로직)
   * 마지막 "확인" 이후의 행들만 반환
   */
  async getNewOrders(): Promise<SheetRow[]> {
    try {
      const allRows = await this.getAllRows();

      if (allRows.length === 0) {
        this.newOrderRows = [];
        return [];
      }

      // 필수 컬럼 검증
      this.validateRequiredColumns(allRows[0]);

      // 마지막 "확인" 행 찾기
      let lastConfirmedIndex = -1;
      for (let i = allRows.length - 1; i >= 0; i--) {
        if (allRows[i]['비고'] === '확인') {
          lastConfirmedIndex = i;
          break;
        }
      }

      // 마지막 확인 이후의 행들 선택
      const newOrders = allRows.slice(lastConfirmedIndex + 1);

      // 처리할 행들의 실제 스프레드시트 행 번호 저장
      this.newOrderRows = newOrders.map(row => row._rowNumber || 0).filter(n => n > 0);

      return newOrders;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get new orders: ${message}`);
    }
  }

  /**
   * 필수 컬럼 검증
   */
  private validateRequiredColumns(sampleRow: SheetRow): void {
    const actualColumns = Object.keys(sampleRow).filter(key => !key.startsWith('_'));
    const missingColumns = this.config.requiredColumns.filter(
      col => !actualColumns.includes(col)
    );

    if (missingColumns.length > 0) {
      throw new Error(
        `스프레드시트에 필수 컬럼이 없습니다: ${missingColumns.join(', ')}\n` +
        `필요한 컬럼: ${this.config.requiredColumns.join(', ')}`
      );
    }
  }

  /**
   * 특정 셀 업데이트
   */
  async updateCell(row: number, col: number, value: string): Promise<void> {
    try {
      const spreadsheetId = await this.getSpreadsheetId();
      const sheetName = await this.getFirstSheetName();

      // 열 번호를 A1 표기법으로 변환 (1 -> A, 2 -> B, ...)
      const colLetter = String.fromCharCode(64 + col);
      const range = `${this.quoteSheetName(sheetName)}!${colLetter}${row}`;

      await this.sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[value]],
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to update cell: ${message}`);
    }
  }

  /**
   * 처리된 주문을 "확인"으로 표시 (Python 버전과 동일한 로직)
   */
  async markAsConfirmed(): Promise<void> {
    try {
      if (this.newOrderRows.length === 0) {
        return; // 처리할 행이 없으면 종료
      }

      const spreadsheetId = await this.getSpreadsheetId();
      const sheetName = await this.getFirstSheetName();

      // 헤더 행을 가져와서 '비고' 열 위치 찾기
      const headerResponse = await this.sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${this.quoteSheetName(sheetName)}!1:1`,
      });

      const headers = headerResponse.data.values?.[0];
      if (!headers) {
        throw new Error('Could not read headers');
      }

      const 비고ColIndex = headers.findIndex(h => h === '비고');
      if (비고ColIndex === -1) {
        throw new Error("Could not find '비고' column");
      }

      const 비고Col = 비고ColIndex + 1; // 1-based

      // 모든 새 주문 행을 '확인'으로 업데이트
      for (const rowNum of this.newOrderRows) {
        await this.updateCell(rowNum, 비고Col, '확인');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to mark orders as confirmed: ${message}`);
    }
  }
}
