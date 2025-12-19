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
import type { SheetRow, OrderStatus } from '../types/order.js';

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
    private sheetService: SheetService | null,
    private databaseService: DatabaseService,
    options: HybridDataServiceOptions
  ) {
    this.mode = options.mode;
    // database 모드에서는 sheetService가 없으므로 fallback 비활성화
    this.fallbackToSheets = this.sheetService !== null && (options.fallbackToSheets ?? true);
    this.logger = options.logger;

    // sheets 또는 hybrid 모드에서 sheetService가 없으면 에러
    if ((this.mode === 'sheets' || this.mode === 'hybrid') && !this.sheetService) {
      throw new Error(`SheetService is required for mode: ${this.mode}`);
    }

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
      return this.sheetService!.getAllRows();
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
        return this.sheetService!.getAllRows();
      }
      throw dbError;
    }
  }

  /**
   * 상태별 주문 가져오기
   *
   * Phase 3: 3단계 상태 체계
   * - 'new' → 신규주문
   * - 'pending_payment' → 입금확인
   * - 'completed' → 배송완료
   * - 'all' → 모든 상태
   *
   * @param status - 상태 필터
   * @param includeDeleted - Soft Delete된 주문 포함 여부 (기본: false)
   */
  async getOrdersByStatus(
    status: 'new' | 'pending_payment' | 'completed' | 'all' = 'new',
    includeDeleted: boolean = false
  ): Promise<SheetRow[]> {
    if (this.mode === 'sheets') {
      return this.sheetService!.getOrdersByStatus(status, includeDeleted);
    }

    if (this.mode === 'database') {
      return this.databaseService.getOrdersByStatus(status, includeDeleted);
    }

    // hybrid: DB 우선
    try {
      const rows = await this.databaseService.getOrdersByStatus(status, includeDeleted);
      this.logger?.info(`[hybrid] getOrdersByStatus(${status}) from DB: ${rows.length} rows`);
      return rows;
    } catch (dbError) {
      if (this.fallbackToSheets) {
        this.logger?.warn(`[hybrid] DB getOrdersByStatus failed, falling back to Sheets: ${dbError}`);
        return this.sheetService!.getOrdersByStatus(status, includeDeleted);
      }
      throw dbError;
    }
  }

  /**
   * 신규 주문 가져오기
   */
  async getNewOrders(): Promise<SheetRow[]> {
    if (this.mode === 'sheets') {
      return this.sheetService!.getNewOrders();
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
        return this.sheetService!.getNewOrders();
      }
      throw dbError;
    }
  }

  /**
   * 행 번호로 주문 가져오기
   */
  async getOrderByRowNumber(rowNumber: number): Promise<SheetRow | null> {
    if (this.mode === 'sheets') {
      return this.sheetService!.getOrderByRowNumber(rowNumber);
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
        return this.sheetService!.getOrderByRowNumber(rowNumber);
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
      return this.sheetService!.markAsConfirmed(rowNumbers);
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
      await this.sheetService!.markAsConfirmed(rowNumbers);
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
      return this.sheetService!.markSingleAsConfirmed(rowNumber);
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
      await this.sheetService!.markSingleAsConfirmed(rowNumber);
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
      return this.sheetService!.updateCell(rowNumber, columnName, value);
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
      await this.sheetService!.updateCell(rowNumber, columnName, value);
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

  /**
   * 주문 상태 변경 (Phase 3)
   * hybrid 모드: DB + Sheets 동시 업데이트
   * @param rowNumber - 행 번호
   * @param newStatus - 새 상태 ('신규주문' | '입금확인' | '배송완료')
   */
  async updateOrderStatus(rowNumber: number, newStatus: OrderStatus): Promise<void> {
    if (this.mode === 'sheets') {
      return this.sheetService!.updateOrderStatus(rowNumber, newStatus);
    }

    if (this.mode === 'database') {
      return this.databaseService.updateOrderStatus(rowNumber, newStatus);
    }

    // hybrid: DB + Sheets 동시 업데이트
    const errors: string[] = [];

    try {
      await this.databaseService.updateOrderStatus(rowNumber, newStatus);
      this.logger?.info(`[hybrid] updateOrderStatus DB success: row ${rowNumber}, status ${newStatus}`);
    } catch (dbError) {
      errors.push(`DB: ${dbError}`);
      this.logger?.error(`[hybrid] updateOrderStatus DB failed: ${dbError}`);
    }

    try {
      await this.sheetService!.updateOrderStatus(rowNumber, newStatus);
      this.logger?.info(`[hybrid] updateOrderStatus Sheets success: row ${rowNumber}, status ${newStatus}`);
    } catch (sheetsError) {
      errors.push(`Sheets: ${sheetsError}`);
      this.logger?.error(`[hybrid] updateOrderStatus Sheets failed: ${sheetsError}`);
    }

    if (errors.length === 2) {
      throw new Error(`Hybrid updateOrderStatus failed: ${errors.join('; ')}`);
    }
  }

  /**
   * 입금확인 처리 (Phase 3)
   * hybrid 모드: DB + Sheets 동시 업데이트
   * @param rowNumbers - 처리할 행 번호 배열
   */
  async markPaymentConfirmed(rowNumbers: number[]): Promise<void> {
    if (this.mode === 'sheets') {
      return this.sheetService!.markPaymentConfirmed(rowNumbers);
    }

    if (this.mode === 'database') {
      return this.databaseService.markPaymentConfirmed(rowNumbers);
    }

    // hybrid: DB + Sheets 동시 업데이트
    const errors: string[] = [];

    try {
      await this.databaseService.markPaymentConfirmed(rowNumbers);
      this.logger?.info(`[hybrid] markPaymentConfirmed DB success: ${rowNumbers.length} rows`);
    } catch (dbError) {
      errors.push(`DB: ${dbError}`);
      this.logger?.error(`[hybrid] markPaymentConfirmed DB failed: ${dbError}`);
    }

    try {
      await this.sheetService!.markPaymentConfirmed(rowNumbers);
      this.logger?.info(`[hybrid] markPaymentConfirmed Sheets success: ${rowNumbers.length} rows`);
    } catch (sheetsError) {
      errors.push(`Sheets: ${sheetsError}`);
      this.logger?.error(`[hybrid] markPaymentConfirmed Sheets failed: ${sheetsError}`);
    }

    if (errors.length === 2) {
      throw new Error(`Hybrid markPaymentConfirmed failed: ${errors.join('; ')}`);
    }
  }

  /**
   * 배송완료 처리 (Phase 3)
   * hybrid 모드: DB + Sheets 동시 업데이트
   * @param rowNumbers - 처리할 행 번호 배열
   */
  async markDelivered(rowNumbers: number[]): Promise<void> {
    if (this.mode === 'sheets') {
      return this.sheetService!.markDelivered(rowNumbers);
    }

    if (this.mode === 'database') {
      return this.databaseService.markDelivered(rowNumbers);
    }

    // hybrid: DB + Sheets 동시 업데이트
    const errors: string[] = [];

    try {
      await this.databaseService.markDelivered(rowNumbers);
      this.logger?.info(`[hybrid] markDelivered DB success: ${rowNumbers.length} rows`);
    } catch (dbError) {
      errors.push(`DB: ${dbError}`);
      this.logger?.error(`[hybrid] markDelivered DB failed: ${dbError}`);
    }

    try {
      await this.sheetService!.markDelivered(rowNumbers);
      this.logger?.info(`[hybrid] markDelivered Sheets success: ${rowNumbers.length} rows`);
    } catch (sheetsError) {
      errors.push(`Sheets: ${sheetsError}`);
      this.logger?.error(`[hybrid] markDelivered Sheets failed: ${sheetsError}`);
    }

    if (errors.length === 2) {
      throw new Error(`Hybrid markDelivered failed: ${errors.join('; ')}`);
    }
  }

  /**
   * Soft Delete (Phase 3)
   * hybrid 모드: DB + Sheets 동시 업데이트
   * @param rowNumbers - 삭제할 행 번호 배열
   */
  async softDelete(rowNumbers: number[]): Promise<void> {
    if (this.mode === 'sheets') {
      return this.sheetService!.softDelete(rowNumbers);
    }

    if (this.mode === 'database') {
      return this.databaseService.softDelete(rowNumbers);
    }

    // hybrid: DB + Sheets 동시 업데이트
    const errors: string[] = [];

    try {
      await this.databaseService.softDelete(rowNumbers);
      this.logger?.info(`[hybrid] softDelete DB success: ${rowNumbers.length} rows`);
    } catch (dbError) {
      errors.push(`DB: ${dbError}`);
      this.logger?.error(`[hybrid] softDelete DB failed: ${dbError}`);
    }

    try {
      await this.sheetService!.softDelete(rowNumbers);
      this.logger?.info(`[hybrid] softDelete Sheets success: ${rowNumbers.length} rows`);
    } catch (sheetsError) {
      errors.push(`Sheets: ${sheetsError}`);
      this.logger?.error(`[hybrid] softDelete Sheets failed: ${sheetsError}`);
    }

    if (errors.length === 2) {
      throw new Error(`Hybrid softDelete failed: ${errors.join('; ')}`);
    }
  }

  /**
   * Soft Delete 복원 (Phase 3)
   * hybrid 모드: DB + Sheets 동시 업데이트
   * @param rowNumbers - 복원할 행 번호 배열
   */
  async restore(rowNumbers: number[]): Promise<void> {
    if (this.mode === 'sheets') {
      return this.sheetService!.restore(rowNumbers);
    }

    if (this.mode === 'database') {
      return this.databaseService.restore(rowNumbers);
    }

    // hybrid: DB + Sheets 동시 업데이트
    const errors: string[] = [];

    try {
      await this.databaseService.restore(rowNumbers);
      this.logger?.info(`[hybrid] restore DB success: ${rowNumbers.length} rows`);
    } catch (dbError) {
      errors.push(`DB: ${dbError}`);
      this.logger?.error(`[hybrid] restore DB failed: ${dbError}`);
    }

    try {
      await this.sheetService!.restore(rowNumbers);
      this.logger?.info(`[hybrid] restore Sheets success: ${rowNumbers.length} rows`);
    } catch (sheetsError) {
      errors.push(`Sheets: ${sheetsError}`);
      this.logger?.error(`[hybrid] restore Sheets failed: ${sheetsError}`);
    }

    if (errors.length === 2) {
      throw new Error(`Hybrid restore failed: ${errors.join('; ')}`);
    }
  }

  /**
   * 삭제된 주문만 조회 (Phase 3)
   */
  async getDeletedOrders(): Promise<SheetRow[]> {
    if (this.mode === 'sheets') {
      return this.sheetService!.getDeletedOrders();
    }

    if (this.mode === 'database') {
      return this.databaseService.getDeletedOrders();
    }

    // hybrid: DB 우선
    try {
      const rows = await this.databaseService.getDeletedOrders();
      this.logger?.info(`[hybrid] getDeletedOrders from DB: ${rows.length} rows`);
      return rows;
    } catch (dbError) {
      if (this.fallbackToSheets) {
        this.logger?.warn(`[hybrid] DB getDeletedOrders failed, falling back to Sheets: ${dbError}`);
        return this.sheetService!.getDeletedOrders();
      }
      throw dbError;
    }
  }
}
