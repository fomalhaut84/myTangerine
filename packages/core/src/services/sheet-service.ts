import { google, sheets_v4 } from 'googleapis';
import { JWT } from 'google-auth-library';
import { Config } from '../config/config.js';
import type { SheetRow, OrderStatus } from '../types/order.js';
import { validateProductSelection, normalizeOrderStatus } from '../types/order.js';
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
  private headers: string[] | null = null; // 헤더 행 캐싱
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
   * 헤더 행 가져오기 (캐싱)
   * API 호출을 줄이기 위해 한 번 가져온 헤더를 캐싱합니다.
   */
  private async getHeaders(): Promise<string[]> {
    // 이미 캐시된 헤더가 있으면 반환
    if (this.headers) {
      return this.headers;
    }

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

      // 캐시에 저장
      this.headers = headers;
      return this.headers;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get headers: ${message}`);
    }
  }

  /**
   * 헤더 캐시 무효화
   * Google Sheet의 컬럼 구조가 변경되었을 때 호출하여 캐시를 초기화합니다.
   */
  clearHeadersCache(): void {
    this.headers = null;
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
   * @param includeDeleted - Soft Delete된 주문 포함 여부 (기본: false)
   */
  async getAllRows(includeDeleted: boolean = false): Promise<SheetRow[]> {
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
      const validRows = allRows.filter((row) => {
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

      // Soft Delete 필터링 (Phase 3)
      if (!includeDeleted) {
        return validRows.filter((row) => {
          // '삭제됨' 컬럼에 값이 있거나 _isDeleted 플래그가 true면 제외
          const deletedValue = row['삭제됨'];
          if (row._isDeleted || (deletedValue && deletedValue.trim() !== '')) {
            return false;
          }
          return true;
        });
      }

      return validRows;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get all rows: ${message}`);
    }
  }

  /**
   * Status별 주문 가져오기
   *
   * Phase 3: 3단계 상태 체계
   * - 'new' → 신규주문 (비고 = '신규주문' 또는 빈 문자열)
   * - 'pending_payment' → 입금확인 (비고 = '입금확인')
   * - 'completed' → 배송완료 (비고 = '배송완료' 또는 '확인')
   * - 'all' → 모든 상태
   *
   * @param status - 상태 필터
   * @param includeDeleted - Soft Delete된 주문 포함 여부 (기본: false)
   */
  async getOrdersByStatus(
    status: 'new' | 'pending_payment' | 'completed' | 'all' = 'new',
    includeDeleted: boolean = false
  ): Promise<SheetRow[]> {
    try {
      // getAllRows(true)로 모든 행 가져오고 여기서 soft delete 필터링 수행
      const allRows = await this.getAllRows(true);

      if (allRows.length === 0) {
        // status='new'일 때만 newOrderRows 초기화 (race condition 방지)
        if (status === 'new') {
          this.newOrderRows = [];
        }
        return [];
      }

      // 필수 컬럼 검증
      this.validateRequiredColumns(allRows[0]);

      // Soft Delete 필터링 (P2 Fix: 공백 문자열도 빈값으로 취급)
      let baseRows = allRows;
      if (!includeDeleted) {
        baseRows = allRows.filter(row => {
          const deletedValue = row['삭제됨'];
          const isDeleted = row._isDeleted || (deletedValue && deletedValue.trim() !== '');
          return !isDeleted;
        });
      }

      // Status에 따라 필터링
      let filteredOrders: SheetRow[];

      switch (status) {
        case 'completed':
          // 배송완료 (하위 호환: '확인'도 포함)
          filteredOrders = baseRows.filter(row => {
            const normalized = normalizeOrderStatus(row['비고']);
            return normalized === '배송완료';
          });
          break;
        case 'pending_payment':
          // 입금확인
          filteredOrders = baseRows.filter(row => {
            const normalized = normalizeOrderStatus(row['비고']);
            return normalized === '입금확인';
          });
          break;
        case 'all':
          // 모든 주문
          filteredOrders = baseRows;
          break;
        case 'new':
        default:
          // 신규주문 (하위 호환: 빈 문자열도 포함)
          filteredOrders = baseRows.filter(row => {
            const normalized = normalizeOrderStatus(row['비고']);
            return normalized === '신규주문';
          });
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

      // 헤더 가져오기 (캐싱됨)
      const headers = await this.getHeaders();

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
   * 열 번호를 A1 표기법 문자로 변환
   * @param col 1-based 열 번호 (1 = A, 26 = Z, 27 = AA, ...)
   * @returns A1 표기법 열 문자 (A, B, ..., Z, AA, AB, ...)
   * @throws {Error} col이 1보다 작은 경우
   */
  private columnToLetter(col: number): string {
    if (col < 1) {
      throw new Error(`Invalid column number: ${col}. Column number must be >= 1`);
    }

    let letter = '';
    let remaining = col;

    while (remaining > 0) {
      const remainder = (remaining - 1) % 26;
      letter = String.fromCharCode(65 + remainder) + letter;
      remaining = Math.floor((remaining - 1) / 26);
    }

    return letter;
  }

  /**
   * 특정 셀 업데이트
   * @param row - 행 번호
   * @param colOrName - 컬럼 번호(1-based) 또는 컬럼 이름
   * @param value - 업데이트할 값
   */
  async updateCell(row: number, colOrName: number | string, value: string): Promise<void> {
    try {
      const spreadsheetId = await this.getSpreadsheetId();
      const sheetName = await this.getFirstSheetName();

      let colLetter: string;

      if (typeof colOrName === 'number') {
        // 열 번호를 A1 표기법으로 변환 (1 -> A, 2 -> B, ..., 27 -> AA, ...)
        colLetter = this.columnToLetter(colOrName);
      } else {
        // 컬럼 이름을 컬럼 번호로 변환
        const headers = await this.getHeaders();
        const colIndex = headers.findIndex(h => h === colOrName);
        if (colIndex === -1) {
          throw new Error(`Column '${colOrName}' not found in headers`);
        }
        colLetter = this.columnToLetter(colIndex + 1); // 1-based
      }

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
   * 한 행의 여러 컬럼을 한 번에 업데이트 (배치 업데이트)
   * @param row - 행 번호 (1-based, 헤더 제외)
   * @param updates - 업데이트할 컬럼명과 값의 매핑 (예: { 'DB_SYNC_STATUS': 'success', 'DB_SYNC_AT': '2025-12-12 14:30:45' })
   */
  async updateRowCells(row: number, updates: Record<string, string>): Promise<void> {
    try {
      const spreadsheetId = await this.getSpreadsheetId();
      const sheetName = await this.getFirstSheetName();
      const headers = await this.getHeaders();

      // 각 컬럼명을 컬럼 레터로 변환하여 범위 생성
      const data: Array<{ range: string; values: string[][] }> = [];

      for (const [columnName, value] of Object.entries(updates)) {
        const colIndex = headers.findIndex(h => h === columnName);
        if (colIndex === -1) {
          throw new Error(`Column '${columnName}' not found in headers`);
        }
        const colLetter = this.columnToLetter(colIndex + 1); // 1-based
        const range = `${this.quoteSheetName(sheetName)}!${colLetter}${row}`;
        data.push({ range, values: [[value]] });
      }

      // 배치 업데이트 실행
      await this.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to update row cells: ${message}`);
    }
  }

  /**
   * 처리된 주문을 "배송완료"로 표시
   * Phase 3: '확인' → '배송완료'로 변경 (하위 호환성 유지)
   * @param rowNumbers - 처리할 행 번호 배열 (선택). 미제공 시 newOrderRows 사용 (하위 호환성)
   */
  async markAsConfirmed(rowNumbers?: number[]): Promise<void> {
    try {
      // 명시적으로 전달된 행 번호 또는 기존 newOrderRows 사용 (하위 호환성)
      const targetRows = rowNumbers || this.newOrderRows;

      if (targetRows.length === 0) {
        return; // 처리할 행이 없으면 종료
      }

      // 헤더 가져오기 (캐싱됨)
      const headers = await this.getHeaders();

      const 비고ColIndex = headers.findIndex(h => h === '비고');
      if (비고ColIndex === -1) {
        throw new Error("Could not find '비고' column");
      }

      const 비고Col = 비고ColIndex + 1; // 1-based

      // 지정된 주문 행을 '배송완료'로 업데이트
      for (const rowNum of targetRows) {
        await this.updateCell(rowNum, 비고Col, '배송완료');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to mark orders as delivered: ${message}`);
    }
  }

  /**
   * 특정 주문 행을 "배송완료"로 표시
   * Phase 3: '확인' → '배송완료'로 변경 (하위 호환성 유지)
   * @param rowNumber 스프레드시트 행 번호 (1-based, 헤더 포함)
   */
  async markSingleAsConfirmed(rowNumber: number): Promise<void> {
    try {
      await this.updateOrderStatus(rowNumber, '배송완료');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to mark single order as delivered: ${message}`);
    }
  }

  /**
   * 주문 상태 변경 (Phase 3)
   * @param rowNumber - 행 번호
   * @param newStatus - 새 상태 ('신규주문' | '입금확인' | '배송완료')
   */
  async updateOrderStatus(rowNumber: number, newStatus: OrderStatus): Promise<void> {
    try {
      const headers = await this.getHeaders();

      const 비고ColIndex = headers.findIndex(h => h === '비고');
      if (비고ColIndex === -1) {
        throw new Error("Could not find '비고' column");
      }

      const 비고Col = 비고ColIndex + 1; // 1-based

      await this.updateCell(rowNumber, 비고Col, newStatus);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to update order status (row: ${rowNumber}, status: ${newStatus}): ${message}`);
    }
  }

  /**
   * 입금확인 처리 (Phase 3)
   * @param rowNumbers - 처리할 행 번호 배열
   */
  async markPaymentConfirmed(rowNumbers: number[]): Promise<void> {
    try {
      for (const rowNum of rowNumbers) {
        await this.updateOrderStatus(rowNum, '입금확인');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to mark payment confirmed (rows: ${rowNumbers.join(', ')}): ${message}`);
    }
  }

  /**
   * 배송완료 처리 (Phase 3)
   * @param rowNumbers - 처리할 행 번호 배열
   * @param trackingNumber - 송장번호 (선택)
   */
  async markDelivered(rowNumbers: number[], trackingNumber?: string): Promise<void> {
    try {
      const headers = await this.getHeaders();

      for (const rowNum of rowNumbers) {
        await this.updateOrderStatus(rowNum, '배송완료');

        // 송장번호가 제공된 경우 저장
        if (trackingNumber) {
          const 송장번호ColIndex = headers.findIndex(h => h === '송장번호');

          if (송장번호ColIndex !== -1) {
            const 송장번호Col = 송장번호ColIndex + 1; // 1-based
            await this.updateCell(rowNum, 송장번호Col, trackingNumber);
          } else {
            console.warn("[SheetService] '송장번호' column not found. Tracking number not saved.");
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to mark as delivered (rows: ${rowNumbers.join(', ')}): ${message}`);
    }
  }

  /**
   * Soft Delete (Phase 3)
   * '삭제됨' 컬럼에 현재 시각을 기록
   * @param rowNumbers - 삭제할 행 번호 배열
   */
  async softDelete(rowNumbers: number[]): Promise<void> {
    try {
      const headers = await this.getHeaders();

      let 삭제됨ColIndex = headers.findIndex(h => h === '삭제됨');

      // '삭제됨' 컬럼이 없으면 경고 (컬럼 추가는 별도 작업 필요)
      if (삭제됨ColIndex === -1) {
        console.warn("[SheetService] '삭제됨' column not found. Soft delete may not work properly.");
        return;
      }

      const 삭제됨Col = 삭제됨ColIndex + 1; // 1-based
      const now = new Date().toISOString();

      for (const rowNum of rowNumbers) {
        await this.updateCell(rowNum, 삭제됨Col, now);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to soft delete orders (rows: ${rowNumbers.join(', ')}): ${message}`);
    }
  }

  /**
   * Soft Delete 복원 (Phase 3)
   * '삭제됨' 컬럼을 빈 문자열로 설정
   * @param rowNumbers - 복원할 행 번호 배열
   */
  async restore(rowNumbers: number[]): Promise<void> {
    try {
      const headers = await this.getHeaders();

      let 삭제됨ColIndex = headers.findIndex(h => h === '삭제됨');

      if (삭제됨ColIndex === -1) {
        console.warn("[SheetService] '삭제됨' column not found.");
        return;
      }

      const 삭제됨Col = 삭제됨ColIndex + 1; // 1-based

      for (const rowNum of rowNumbers) {
        await this.updateCell(rowNum, 삭제됨Col, '');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to restore orders (rows: ${rowNumbers.join(', ')}): ${message}`);
    }
  }

  /**
   * 삭제된 주문만 조회 (Phase 3)
   */
  async getDeletedOrders(): Promise<SheetRow[]> {
    try {
      // P1 Fix: 삭제된 행을 포함하여 조회해야 함
      const allRows = await this.getAllRows(true);
      // P2 Fix: 공백 문자열도 빈값으로 취급
      return allRows.filter(row => {
        const deletedValue = row['삭제됨'];
        return row._isDeleted || (deletedValue && deletedValue.trim() !== '');
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get deleted orders: ${message}`);
    }
  }

  /**
   * 새 행 추가 (Issue #152: 배송사고 주문 생성용)
   * 스프레드시트 끝에 새 행을 추가합니다.
   *
   * @param rowData - 추가할 행 데이터 (컬럼명 -> 값 매핑)
   * @returns 추가된 행 번호
   */
  async appendRow(rowData: Record<string, string>): Promise<number> {
    try {
      const spreadsheetId = await this.getSpreadsheetId();
      const sheetName = await this.getFirstSheetName();
      const headers = await this.getHeaders();

      // 헤더 순서에 맞게 값 배열 생성
      const values = headers.map(header => rowData[header] || '');

      // 행 추가
      const response = await this.sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${this.quoteSheetName(sheetName)}!A:A`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [values],
        },
      });

      // 추가된 행 번호 계산
      // response.data.updates.updatedRange 형식: "'시트명'!A123:Z123"
      const updatedRange = response.data.updates?.updatedRange;
      if (!updatedRange) {
        throw new Error('Failed to get updated range from append response');
      }

      // 범위에서 행 번호 추출
      // 형식 1: "'시트명'!A123:Z123" -> 123
      // 형식 2: "'시트명'!A123" -> 123 (콜론 없는 경우)
      const match = updatedRange.match(/!A(\d+)(?::|$)/);
      if (!match) {
        throw new Error(`Failed to parse row number from range: ${updatedRange}`);
      }

      const newRowNumber = parseInt(match[1], 10);
      return newRowNumber;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to append row: ${message}`);
    }
  }

  /**
   * 주문 정보 수정 (Issue #136)
   * 수정 가능한 필드만 업데이트
   *
   * @param rowNumber - 행 번호 (1-based)
   * @param updates - 업데이트할 필드들
   */
  async updateOrder(
    rowNumber: number,
    updates: {
      sender?: { name?: string; phone?: string; address?: string };
      recipient?: { name?: string; phone?: string; address?: string };
      productType?: '5kg' | '10kg' | '비상품';
      quantity?: number;
      orderType?: 'customer' | 'gift' | 'claim';
      trackingNumber?: string;
    }
  ): Promise<void> {
    try {
      // 필드 매핑: Order 필드 -> 시트 컬럼명
      const columnUpdates: Record<string, string> = {};

      // 발송인 정보
      if (updates.sender) {
        if (updates.sender.name !== undefined) {
          columnUpdates['보내는분 성함'] = updates.sender.name;
        }
        if (updates.sender.phone !== undefined) {
          columnUpdates['보내는분 연락처 (핸드폰번호)'] = updates.sender.phone;
        }
        if (updates.sender.address !== undefined) {
          columnUpdates['보내는분 주소 (도로명 주소로 부탁드려요)'] = updates.sender.address;
        }
      }

      // 수취인 정보
      if (updates.recipient) {
        if (updates.recipient.name !== undefined) {
          columnUpdates['받으실분 성함'] = updates.recipient.name;
        }
        if (updates.recipient.phone !== undefined) {
          columnUpdates['받으실분 연락처 (핸드폰번호)'] = updates.recipient.phone;
        }
        if (updates.recipient.address !== undefined) {
          columnUpdates['받으실분 주소 (도로명 주소로 부탁드려요)'] = updates.recipient.address;
        }
      }

      // 상품 정보
      if (updates.productType !== undefined) {
        columnUpdates['상품 선택'] = updates.productType;
      }

      // 수량 (5kg 또는 10kg 수량 컬럼에 저장)
      if (updates.quantity !== undefined) {
        // 현재 주문 조회하여 상품 타입 확인
        const currentOrder = await this.getOrderByRowNumber(rowNumber);
        if (currentOrder) {
          const productType = updates.productType || currentOrder['상품 선택'];
          if (productType?.includes('5kg')) {
            columnUpdates['5kg 수량'] = String(updates.quantity);
            columnUpdates['10kg 수량'] = '';
          } else if (productType?.includes('10kg')) {
            columnUpdates['10kg 수량'] = String(updates.quantity);
            columnUpdates['5kg 수량'] = '';
          }
        }
      }

      // 주문 유형 (Issue #152: claim 추가)
      if (updates.orderType !== undefined) {
        columnUpdates['주문유형'] = updates.orderType === 'gift'
          ? '선물'
          : updates.orderType === 'claim'
            ? '배송사고'
            : '판매';
      }

      // 송장번호
      if (updates.trackingNumber !== undefined) {
        columnUpdates['송장번호'] = updates.trackingNumber;
      }

      // 업데이트할 필드가 없으면 종료
      if (Object.keys(columnUpdates).length === 0) {
        return;
      }

      // 배치 업데이트 실행
      await this.updateRowCells(rowNumber, columnUpdates);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to update order (row: ${rowNumber}): ${message}`);
    }
  }
}
