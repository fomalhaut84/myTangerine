import { google, sheets_v4 } from 'googleapis';
import { JWT } from 'google-auth-library';
import { Config } from '../config/config.js';
import type { SheetRow } from '../types/order.js';
import { validateProductSelection } from '../types/order.js';
import fs from 'fs';

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
  private loggedInvalidRows: Set<number> = new Set(); // 이미 로그에 출력된 행 번호 캐싱

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
      let credentials: { client_email: string; private_key: string };

      // 우선순위에 따라 credentials 로드: PATH > FILE > JSON
      if (this.config.credentialsPath) {
        // 파일에서 로드 (우선순위 1)
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
    // 매 요청마다 로그 캐시 초기화 (수정된 데이터의 재검증을 위해)
    this.loggedInvalidRows.clear();

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

      // 헤더 검증 먼저 수행 (데이터 변환 전)
      const headerRow: Record<string, string> = {};
      headers.forEach((header) => {
        headerRow[header] = '';
      });
      this.validateRequiredColumns(headerRow as unknown as SheetRow);

      // 헤더를 키로 사용하여 객체 배열로 변환
      const allRows = dataRows.map((row, index) => {
        const rowData: Record<string, string | number> = {};
        headers.forEach((header, i) => {
          rowData[header] = row[i] || '';
        });
        // 실제 스프레드시트 행 번호 저장 (헤더 행 + 1, 1-based)
        rowData._rowNumber = index + 2;
        return rowData as unknown as SheetRow;
      });

      // 필수 필드가 비어있는 행은 제외 (데이터 정합성 유지)
      // 타임스탬프, 받으실분 정보(이름, 주소, 전화번호)는 반드시 필요
      // 상품 선택은 검증하되, 실패해도 제외하지 않고 _validationError 필드에 저장
      return allRows.filter((row) => {
        const timestamp = row['타임스탬프'] || '';
        const recipientName = row['받으실분 성함'] || '';
        const recipientAddress = row['받으실분 주소 (도로명 주소로 부탁드려요)'] || '';
        const recipientPhone = row['받으실분 연락처 (핸드폰번호)'] || '';
        const productSelection = row['상품 선택'] || '';

        // 기본 필수 필드 검증
        const hasRequiredFields = (
          timestamp.trim() !== '' &&
          recipientName.trim() !== '' &&
          recipientAddress.trim() !== '' &&
          recipientPhone.trim() !== ''
        );

        // 필수 필드 누락 시 제외
        if (!hasRequiredFields) {
          if (row._rowNumber && !this.loggedInvalidRows.has(row._rowNumber)) {
            this.loggedInvalidRows.add(row._rowNumber);
            console.warn(`[SheetService] 필수 필드 누락으로 행 제외: 행 ${row._rowNumber}`);
          }
          return false;
        }

        // 상품 선택 유효성 검증 (validateProductSelection 헬퍼 사용)
        const productValidation = validateProductSelection(productSelection);

        // 상품 선택 검증 실패 시 _validationError 필드에 저장하고 행 포함
        if (!productValidation.isValid) {
          row._validationError = productValidation.reason;
          if (row._rowNumber && !this.loggedInvalidRows.has(row._rowNumber)) {
            this.loggedInvalidRows.add(row._rowNumber);
            console.warn(`[SheetService] ${productValidation.reason}: 행 ${row._rowNumber} (API 응답에 포함됨)`);
            console.warn(`[SheetService] 실제 값: "${productSelection}" (길이: ${productSelection.length}, 코드포인트: ${Array.from(productSelection).map(c => c.charCodeAt(0)).join(',')})`);
          }
        }

        return true;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get all rows: ${message}`);
    }
  }

  /**
   * Status별 주문 가져오기
   * @param status - 'new' (비고 != "확인"), 'completed' (비고 == "확인"), 'all' (모든 행)
   */
  async getOrdersByStatus(status: 'new' | 'completed' | 'all' = 'new'): Promise<SheetRow[]> {
    try {
      const allRows = await this.getAllRows();

      if (allRows.length === 0) {
        // status='new'일 때만 newOrderRows 초기화 (race condition 방지)
        if (status === 'new') {
          this.newOrderRows = [];
        }
        return [];
      }

      // 필수 컬럼 검증
      this.validateRequiredColumns(allRows[0]);

      // Status에 따라 필터링
      let filteredOrders: SheetRow[];

      switch (status) {
        case 'completed':
          // 비고가 "확인"인 주문
          filteredOrders = allRows.filter(row => row['비고'] === '확인');
          break;
        case 'all':
          // 모든 주문
          filteredOrders = allRows;
          break;
        case 'new':
        default:
          // 비고가 "확인"이 아닌 주문 (기본값)
          filteredOrders = allRows.filter(row => row['비고'] !== '확인');
          break;
      }

      // status='new'일 때만 처리할 행들의 실제 스프레드시트 행 번호 저장 (race condition 방지)
      if (status === 'new') {
        this.newOrderRows = filteredOrders.map(row => row._rowNumber || 0).filter(n => n > 0);
      }

      return filteredOrders;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get orders by status: ${message}`);
    }
  }

  /**
   * 새로운 주문만 가져오기 (하위 호환성)
   * 비고 컬럼이 "확인"이 아닌 모든 행 반환
   *
   * 개별 주문 확인을 지원하기 위해 로직 변경:
   * - 이전: 마지막 "확인" 행 이후의 모든 행
   * - 현재: 비고가 "확인"이 아닌 모든 행
   *
   * 이렇게 하면 순서에 상관없이 개별 확인이 가능하며,
   * 다른 미확인 주문이 건너뛰어지지 않습니다.
   */
  async getNewOrders(): Promise<SheetRow[]> {
    return this.getOrdersByStatus('new');
  }

  /**
   * 특정 행 번호로 주문 조회
   * @param rowNumber 스프레드시트 행 번호 (1-based, 헤더 포함)
   * @returns 주문 데이터 또는 null (행이 없거나 필수 필드가 누락된 경우)
   */
  async getOrderByRowNumber(rowNumber: number): Promise<SheetRow | null> {
    try {
      const spreadsheetId = await this.getSpreadsheetId();
      const sheetName = await this.getFirstSheetName();

      // 헤더 행 가져오기
      const headerResponse = await this.sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${this.quoteSheetName(sheetName)}!1:1`,
      });

      const headers = headerResponse.data.values?.[0];
      if (!headers) {
        throw new Error('Could not read headers');
      }

      // 헤더 검증
      const headerRow: Record<string, string> = {};
      headers.forEach((header) => {
        headerRow[header] = '';
      });
      this.validateRequiredColumns(headerRow as unknown as SheetRow);

      // 특정 행 가져오기
      const rowResponse = await this.sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${this.quoteSheetName(sheetName)}!${rowNumber}:${rowNumber}`,
      });

      const rowData = rowResponse.data.values?.[0];
      if (!rowData) {
        // 행이 존재하지 않음
        return null;
      }

      // 행 데이터를 객체로 변환
      const row: Record<string, string | number> = {};
      headers.forEach((header, i) => {
        row[header] = rowData[i] || '';
      });
      row._rowNumber = rowNumber;

      const sheetRow = row as unknown as SheetRow;

      // 필수 필드 검증
      const timestamp = sheetRow['타임스탬프'] || '';
      const recipientName = sheetRow['받으실분 성함'] || '';
      const recipientAddress = sheetRow['받으실분 주소 (도로명 주소로 부탁드려요)'] || '';
      const recipientPhone = sheetRow['받으실분 연락처 (핸드폰번호)'] || '';

      const hasRequiredFields = (
        timestamp.trim() !== '' &&
        recipientName.trim() !== '' &&
        recipientAddress.trim() !== '' &&
        recipientPhone.trim() !== ''
      );

      if (!hasRequiredFields) {
        // 필수 필드 누락
        return null;
      }

      // 상품 선택 검증
      const productSelection = sheetRow['상품 선택'] || '';
      const productValidation = validateProductSelection(productSelection);

      if (!productValidation.isValid) {
        sheetRow._validationError = productValidation.reason;
      }

      return sheetRow;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get order by row number: ${message}`);
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
   * @param rowNumbers - 확인 처리할 행 번호 배열 (선택). 미제공 시 newOrderRows 사용 (하위 호환성)
   */
  async markAsConfirmed(rowNumbers?: number[]): Promise<void> {
    try {
      // 명시적으로 전달된 행 번호 또는 기존 newOrderRows 사용 (하위 호환성)
      const targetRows = rowNumbers || this.newOrderRows;

      if (targetRows.length === 0) {
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

      // 지정된 주문 행을 '확인'으로 업데이트
      for (const rowNum of targetRows) {
        await this.updateCell(rowNum, 비고Col, '확인');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to mark orders as confirmed: ${message}`);
    }
  }

  /**
   * 특정 주문 행을 "확인"으로 표시
   * @param rowNumber 스프레드시트 행 번호 (1-based, 헤더 포함)
   */
  async markSingleAsConfirmed(rowNumber: number): Promise<void> {
    try {
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

      // 특정 행을 '확인'으로 업데이트
      await this.updateCell(rowNumber, 비고Col, '확인');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to mark single order as confirmed: ${message}`);
    }
  }
}
