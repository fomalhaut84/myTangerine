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

/**
 * 배송사고 주문 생성 결과 (Issue #152, #155)
 *
 * Issue #155: 배송사고는 DB에만 저장, sheetRowNumber는 null
 */
export interface CreateClaimOrderResult {
  /** 생성된 배송사고 주문의 DB id */
  id: number;
  /** 원본 주문의 sheetRowNumber (추적용) */
  originalRowNumber: number;
}

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
   * @param includeDeleted - Soft Delete된 주문 포함 여부 (기본: false)
   */
  async getAllRows(includeDeleted: boolean = false): Promise<SheetRow[]> {
    if (this.mode === 'sheets') {
      return this.sheetService!.getAllRows(includeDeleted);
    }

    if (this.mode === 'database') {
      return this.databaseService.getAllRows(includeDeleted);
    }

    // hybrid: DB 우선, 실패 시 Sheets fallback
    try {
      const rows = await this.databaseService.getAllRows(includeDeleted);
      this.logger?.info(`[hybrid] getAllRows from DB: ${rows.length} rows`);
      return rows;
    } catch (dbError) {
      if (this.fallbackToSheets) {
        this.logger?.warn(`[hybrid] DB getAllRows failed, falling back to Sheets: ${dbError}`);
        return this.sheetService!.getAllRows(includeDeleted);
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
   * Issue #155: DB ID로 주문 가져오기 (claim 주문 등 sheetRowNumber가 null인 경우)
   * database/hybrid 모드에서만 지원
   */
  async getOrderById(id: number): Promise<SheetRow | null> {
    if (this.mode === 'sheets') {
      // sheets 모드에서는 DB ID 조회 불가
      this.logger?.warn(`[hybrid] getOrderById not supported in sheets mode`);
      return null;
    }

    // database/hybrid: DB에서 직접 조회
    const row = await this.databaseService.getOrderById(id);
    this.logger?.info(`[hybrid] getOrderById(${id}) from DB: ${row ? 'found' : 'not found'}`);
    return row;
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
      // Web에서 호출되므로 changedBy='web'
      return this.databaseService.markAsConfirmed(rowNumbers, 'web');
    }

    // hybrid: DB + Sheets 동시 업데이트
    const errors: string[] = [];

    try {
      // Web에서 호출되므로 changedBy='web'
      await this.databaseService.markAsConfirmed(rowNumbers, 'web');
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
      // Web에서 호출되므로 changedBy='web'
      return this.databaseService.markSingleAsConfirmed(rowNumber, 'web');
    }

    // hybrid: DB + Sheets 동시 업데이트
    const errors: string[] = [];

    try {
      // Web에서 호출되므로 changedBy='web'
      await this.databaseService.markSingleAsConfirmed(rowNumber, 'web');
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
      return this.databaseService.updateOrderStatus(rowNumber, newStatus, 'web');
    }

    // hybrid: DB + Sheets 동시 업데이트
    const errors: string[] = [];

    try {
      await this.databaseService.updateOrderStatus(rowNumber, newStatus, 'web');
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
      return this.databaseService.markPaymentConfirmed(rowNumbers, 'web');
    }

    // hybrid: DB + Sheets 동시 업데이트
    const errors: string[] = [];

    try {
      await this.databaseService.markPaymentConfirmed(rowNumbers, 'web');
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
   * @param trackingNumber - 송장번호 (선택)
   */
  async markDelivered(rowNumbers: number[], trackingNumber?: string): Promise<void> {
    if (this.mode === 'sheets') {
      return this.sheetService!.markDelivered(rowNumbers, trackingNumber);
    }

    if (this.mode === 'database') {
      return this.databaseService.markDelivered(rowNumbers, trackingNumber, 'web');
    }

    // hybrid: DB + Sheets 동시 업데이트
    const errors: string[] = [];

    try {
      await this.databaseService.markDelivered(rowNumbers, trackingNumber, 'web');
      this.logger?.info(`[hybrid] markDelivered DB success: ${rowNumbers.length} rows`);
    } catch (dbError) {
      errors.push(`DB: ${dbError}`);
      this.logger?.error(`[hybrid] markDelivered DB failed: ${dbError}`);
    }

    try {
      await this.sheetService!.markDelivered(rowNumbers, trackingNumber);
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
   * 배송완료 처리 - DB ID 기반 (Issue #168: claim 주문용)
   * claim 주문은 DB 전용이므로 시트 업데이트 없이 DB만 업데이트
   * @param dbId - DB ID
   * @param trackingNumber - 송장번호 (선택)
   */
  async markDeliveredById(dbId: number, trackingNumber?: string): Promise<void> {
    // claim 주문은 DB 전용이므로 sheets 모드에서는 지원 안 함
    if (this.mode === 'sheets') {
      throw new Error('markDeliveredById is not supported in sheets mode. Claim orders require database mode.');
    }

    // database 또는 hybrid 모드: DB만 업데이트 (claim 주문은 시트에 없음)
    await this.databaseService.markDeliveredById(dbId, trackingNumber, 'web');
    this.logger?.info(`[${this.mode}] markDeliveredById DB success: id=${dbId}`);
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
      return this.databaseService.softDelete(rowNumbers, 'web');
    }

    // hybrid: DB + Sheets 동시 업데이트
    const errors: string[] = [];

    try {
      await this.databaseService.softDelete(rowNumbers, 'web');
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
      return this.databaseService.restore(rowNumbers, 'web');
    }

    // hybrid: DB + Sheets 동시 업데이트
    const errors: string[] = [];

    try {
      await this.databaseService.restore(rowNumbers, 'web');
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

  /**
   * 주문 정보 수정 (Issue #136)
   * hybrid 모드: DB + Sheets 동시 업데이트
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
    if (this.mode === 'sheets') {
      return this.sheetService!.updateOrder(rowNumber, updates);
    }

    if (this.mode === 'database') {
      // Web에서 호출되므로 changedBy='web'
      return this.databaseService.updateOrder(rowNumber, updates, 'web');
    }

    // hybrid: DB + Sheets 동시 업데이트
    const errors: string[] = [];

    try {
      // Web에서 호출되므로 changedBy='web'
      await this.databaseService.updateOrder(rowNumber, updates, 'web');
      this.logger?.info(`[hybrid] updateOrder DB success: row ${rowNumber}`);
    } catch (dbError) {
      errors.push(`DB: ${dbError}`);
      this.logger?.error(`[hybrid] updateOrder DB failed: ${dbError}`);
    }

    try {
      await this.sheetService!.updateOrder(rowNumber, updates);
      this.logger?.info(`[hybrid] updateOrder Sheets success: row ${rowNumber}`);
    } catch (sheetsError) {
      errors.push(`Sheets: ${sheetsError}`);
      this.logger?.error(`[hybrid] updateOrder Sheets failed: ${sheetsError}`);
    }

    // 둘 다 실패하면 에러 throw
    if (errors.length === 2) {
      throw new Error(`Hybrid updateOrder failed: ${errors.join('; ')}`);
    }
  }

  /**
   * 배송사고 주문 생성 (Issue #152, #155)
   * 원본 주문을 복제하여 orderType='claim'인 새 주문 생성
   *
   * @param originalRowNumber - 원본 주문의 행 번호
   * @returns 생성 결과 (DB id + 원본 주문 참조)
   *
   * @note Issue #155: 배송사고는 DB에만 저장 (Sheets에 저장하지 않음)
   *       - sheetRowNumber: null (Sheets 행 번호 충돌 방지)
   *       - originalRowNumber: 원본 주문 참조 (추적용)
   */
  async createClaimOrder(originalRowNumber: number): Promise<CreateClaimOrderResult> {
    if (this.mode === 'sheets') {
      throw new Error('createClaimOrder is not supported in sheets mode');
    }

    // Issue #155: database/hybrid 모드 모두 DB에만 저장
    const id = await this.databaseService.createClaimOrder(originalRowNumber);
    this.logger?.info(`[${this.mode}] createClaimOrder success: DB id ${id}, original row ${originalRowNumber}`);

    return { id, originalRowNumber };
  }

  /**
   * ChangeLogService getter (DatabaseService를 통해 접근)
   */
  get changeLogService() {
    return this.databaseService.changeLogService;
  }
}
