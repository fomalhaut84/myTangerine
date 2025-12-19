/**
 * HybridDataService
 *
 * Phase 2.3: 하이브리드 운영 모드
 * - sheets: Google Sheets만 사용 (기존 방식)
 * - database: PostgreSQL만 사용
 * - hybrid: DB 우선 읽기, DB+Sheets 동시 쓰기
 *
 * Issue #68 Phase 2.3
 */

import type { SheetService } from './sheet-service.js';
import type { DatabaseService } from './database-service.js';
import type { SheetRow } from '../types/order.js';

export type DataSourceMode = 'sheets' | 'database' | 'hybrid';

export interface HybridDataServiceOptions {
  mode: DataSourceMode;
  /** hybrid 모드에서 DB 실패 시 Sheets fallback 여부 (기본: true) */
  fallbackToSheets?: boolean;
  /** 로거 (선택) */
  logger?: {
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
    error(msg: string, ...args: unknown[]): void;
  };
}

/**
 * 하이브리드 데이터 서비스
 * SheetService와 DatabaseService를 통합하여 데이터 소스 전환 지원
 */
export class HybridDataService {
  private mode: DataSourceMode;
  private fallbackToSheets: boolean;
  private logger?: HybridDataServiceOptions['logger'];

  constructor(
    private sheetService: SheetService,
    private databaseService: DatabaseService,
    options: HybridDataServiceOptions
  ) {
    this.mode = options.mode;
    this.fallbackToSheets = options.fallbackToSheets ?? true;
    this.logger = options.logger;

    this.logger?.info(`HybridDataService initialized with mode: ${this.mode}`);
  }

  /**
   * 현재 데이터 소스 모드
   */
  getMode(): DataSourceMode {
    return this.mode;
  }

  /**
   * 모든 행 가져오기
   */
  async getAllRows(): Promise<SheetRow[]> {
    if (this.mode === 'sheets') {
      return this.sheetService.getAllRows();
    }

    if (this.mode === 'database') {
      return this.databaseService.getAllRows();
    }

    // hybrid: DB 우선, 실패 시 Sheets fallback
    try {
      const rows = await this.databaseService.getAllRows();
      this.logger?.info(`[hybrid] getAllRows from DB: ${rows.length} rows`);
      return rows;
    } catch (dbError) {
      if (this.fallbackToSheets) {
        this.logger?.warn(`[hybrid] DB getAllRows failed, falling back to Sheets: ${dbError}`);
        return this.sheetService.getAllRows();
      }
      throw dbError;
    }
  }

  /**
   * 상태별 주문 가져오기
   */
  async getOrdersByStatus(status: 'new' | 'completed' | 'all' = 'new'): Promise<SheetRow[]> {
    if (this.mode === 'sheets') {
      return this.sheetService.getOrdersByStatus(status);
    }

    if (this.mode === 'database') {
      return this.databaseService.getOrdersByStatus(status);
    }

    // hybrid: DB 우선
    try {
      const rows = await this.databaseService.getOrdersByStatus(status);
      this.logger?.info(`[hybrid] getOrdersByStatus(${status}) from DB: ${rows.length} rows`);
      return rows;
    } catch (dbError) {
      if (this.fallbackToSheets) {
        this.logger?.warn(`[hybrid] DB getOrdersByStatus failed, falling back to Sheets: ${dbError}`);
        return this.sheetService.getOrdersByStatus(status);
      }
      throw dbError;
    }
  }

  /**
   * 신규 주문 가져오기
   */
  async getNewOrders(): Promise<SheetRow[]> {
    if (this.mode === 'sheets') {
      return this.sheetService.getNewOrders();
    }

    if (this.mode === 'database') {
      return this.databaseService.getNewOrders();
    }

    // hybrid: DB 우선
    try {
      const rows = await this.databaseService.getNewOrders();
      this.logger?.info(`[hybrid] getNewOrders from DB: ${rows.length} rows`);
      return rows;
    } catch (dbError) {
      if (this.fallbackToSheets) {
        this.logger?.warn(`[hybrid] DB getNewOrders failed, falling back to Sheets: ${dbError}`);
        return this.sheetService.getNewOrders();
      }
      throw dbError;
    }
  }

  /**
   * 행 번호로 주문 가져오기
   */
  async getOrderByRowNumber(rowNumber: number): Promise<SheetRow | null> {
    if (this.mode === 'sheets') {
      return this.sheetService.getOrderByRowNumber(rowNumber);
    }

    if (this.mode === 'database') {
      return this.databaseService.getOrderByRowNumber(rowNumber);
    }

    // hybrid: DB 우선
    try {
      const row = await this.databaseService.getOrderByRowNumber(rowNumber);
      this.logger?.info(`[hybrid] getOrderByRowNumber(${rowNumber}) from DB: ${row ? 'found' : 'not found'}`);
      return row;
    } catch (dbError) {
      if (this.fallbackToSheets) {
        this.logger?.warn(`[hybrid] DB getOrderByRowNumber failed, falling back to Sheets: ${dbError}`);
        return this.sheetService.getOrderByRowNumber(rowNumber);
      }
      throw dbError;
    }
  }

  /**
   * 주문 확인 처리 (복수)
   * hybrid 모드: DB + Sheets 동시 업데이트
   */
  async markAsConfirmed(rowNumbers?: number[]): Promise<void> {
    if (this.mode === 'sheets') {
      return this.sheetService.markAsConfirmed(rowNumbers);
    }

    if (this.mode === 'database') {
      return this.databaseService.markAsConfirmed(rowNumbers);
    }

    // hybrid: DB + Sheets 동시 업데이트
    const errors: string[] = [];

    try {
      await this.databaseService.markAsConfirmed(rowNumbers);
      this.logger?.info(`[hybrid] markAsConfirmed DB success: ${rowNumbers?.length ?? 'all'} rows`);
    } catch (dbError) {
      errors.push(`DB: ${dbError}`);
      this.logger?.error(`[hybrid] markAsConfirmed DB failed: ${dbError}`);
    }

    try {
      await this.sheetService.markAsConfirmed(rowNumbers);
      this.logger?.info(`[hybrid] markAsConfirmed Sheets success: ${rowNumbers?.length ?? 'all'} rows`);
    } catch (sheetsError) {
      errors.push(`Sheets: ${sheetsError}`);
      this.logger?.error(`[hybrid] markAsConfirmed Sheets failed: ${sheetsError}`);
    }

    // 둘 다 실패하면 에러 throw
    if (errors.length === 2) {
      throw new Error(`Hybrid markAsConfirmed failed: ${errors.join('; ')}`);
    }
  }

  /**
   * 단일 주문 확인 처리
   * hybrid 모드: DB + Sheets 동시 업데이트
   */
  async markSingleAsConfirmed(rowNumber: number): Promise<void> {
    if (this.mode === 'sheets') {
      return this.sheetService.markSingleAsConfirmed(rowNumber);
    }

    if (this.mode === 'database') {
      return this.databaseService.markSingleAsConfirmed(rowNumber);
    }

    // hybrid: DB + Sheets 동시 업데이트
    const errors: string[] = [];

    try {
      await this.databaseService.markSingleAsConfirmed(rowNumber);
      this.logger?.info(`[hybrid] markSingleAsConfirmed DB success: row ${rowNumber}`);
    } catch (dbError) {
      errors.push(`DB: ${dbError}`);
      this.logger?.error(`[hybrid] markSingleAsConfirmed DB failed: ${dbError}`);
    }

    try {
      await this.sheetService.markSingleAsConfirmed(rowNumber);
      this.logger?.info(`[hybrid] markSingleAsConfirmed Sheets success: row ${rowNumber}`);
    } catch (sheetsError) {
      errors.push(`Sheets: ${sheetsError}`);
      this.logger?.error(`[hybrid] markSingleAsConfirmed Sheets failed: ${sheetsError}`);
    }

    // 둘 다 실패하면 에러 throw
    if (errors.length === 2) {
      throw new Error(`Hybrid markSingleAsConfirmed failed: ${errors.join('; ')}`);
    }
  }

  /**
   * 셀 업데이트
   * hybrid 모드: DB + Sheets 동시 업데이트
   */
  async updateCell(rowNumber: number, columnName: string, value: string): Promise<void> {
    if (this.mode === 'sheets') {
      return this.sheetService.updateCell(rowNumber, columnName, value);
    }

    if (this.mode === 'database') {
      return this.databaseService.updateCell(rowNumber, columnName, value);
    }

    // hybrid: DB + Sheets 동시 업데이트
    const errors: string[] = [];

    try {
      await this.databaseService.updateCell(rowNumber, columnName, value);
      this.logger?.info(`[hybrid] updateCell DB success: row ${rowNumber}, ${columnName}`);
    } catch (dbError) {
      errors.push(`DB: ${dbError}`);
      this.logger?.error(`[hybrid] updateCell DB failed: ${dbError}`);
    }

    try {
      await this.sheetService.updateCell(rowNumber, columnName, value);
      this.logger?.info(`[hybrid] updateCell Sheets success: row ${rowNumber}, ${columnName}`);
    } catch (sheetsError) {
      errors.push(`Sheets: ${sheetsError}`);
      this.logger?.error(`[hybrid] updateCell Sheets failed: ${sheetsError}`);
    }

    // 둘 다 실패하면 에러 throw
    if (errors.length === 2) {
      throw new Error(`Hybrid updateCell failed: ${errors.join('; ')}`);
    }
  }
}
