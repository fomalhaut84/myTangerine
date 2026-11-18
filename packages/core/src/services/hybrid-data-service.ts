/**
 * HybridDataService
 *
 * Phase 2.3: 하이브리드 운영 모드
 * - sheets: Google Sheets만 사용 (기존 방식)
 * - database: PostgreSQL만 사용
 * - hybrid: DB 우선 읽기(실패 시 시트 폴백), 쓰기는 DB 우선 — DB 실패면 중단 · 시트 실패면 partial (#197)
 *
 * Issue #68 Phase 2.3
 */

import type { SheetService } from './sheet-service.js';
import type { DatabaseService } from './database-service.js';
import type { SheetRow, OrderStatus } from '../types/order.js';
import {
  HybridWriteError,
  describeError,
  sheetPartial,
  writeOk,
  type WriteOutcome,
} from './hybrid-write.js';

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
        this.logger?.warn(`[hybrid-fallback] DB getAllRows failed, falling back to Sheets: ${describeError(dbError)}`);
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
        this.logger?.warn(`[hybrid-fallback] DB getOrdersByStatus failed, falling back to Sheets: ${describeError(dbError)}`);
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
        this.logger?.warn(`[hybrid-fallback] DB getNewOrders failed, falling back to Sheets: ${describeError(dbError)}`);
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
        this.logger?.warn(`[hybrid-fallback] DB getOrderByRowNumber failed, falling back to Sheets: ${describeError(dbError)}`);
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
   * hybrid 모드: DB 우선 (#197) — `hybridWrite` 참고
   */
  async markAsConfirmed(rowNumbers?: number[]): Promise<WriteOutcome> {
    // #234: DB 쪽은 행 번호를 명시해야만 처리한다. hybrid 에서 시트만 예전 하위 호환(newOrderRows)으로 쓰면
    // 두 저장소가 갈라지므로 database·hybrid 모드에서는 둘 다 건너뛴다. sheets 모드는 기존 동작 그대로
    if (this.mode !== 'sheets' && (!rowNumbers || rowNumbers.length === 0)) {
      return writeOk();
    }
    return this.write(
      'markAsConfirmed',
      rowNumbers,
      // Web에서 호출되므로 changedBy='web'
      () => this.databaseService.markAsConfirmed(rowNumbers, 'web'),
      () => this.sheetService!.markAsConfirmed(rowNumbers)
    );
  }

  /**
   * 단일 주문 확인 처리
   */
  async markSingleAsConfirmed(rowNumber: number): Promise<WriteOutcome> {
    return this.write(
      'markSingleAsConfirmed',
      [rowNumber],
      () => this.databaseService.markSingleAsConfirmed(rowNumber, 'web'),
      () => this.sheetService!.markSingleAsConfirmed(rowNumber)
    );
  }

  /**
   * 셀 업데이트
   */
  async updateCell(rowNumber: number, columnName: string, value: string): Promise<WriteOutcome> {
    return this.write(
      'updateCell',
      [rowNumber],
      () => this.databaseService.updateCell(rowNumber, columnName, value),
      () => this.sheetService!.updateCell(rowNumber, columnName, value)
    );
  }

  /**
   * 주문 상태 변경 (Phase 3)
   * @param rowNumber - 행 번호
   * @param newStatus - 새 상태 ('신규주문' | '입금확인' | '배송완료')
   */
  async updateOrderStatus(rowNumber: number, newStatus: OrderStatus): Promise<WriteOutcome> {
    return this.write(
      'updateOrderStatus',
      [rowNumber],
      () => this.databaseService.updateOrderStatus(rowNumber, newStatus, 'web'),
      () => this.sheetService!.updateOrderStatus(rowNumber, newStatus)
    );
  }

  /**
   * 입금확인 처리 (Phase 3)
   * @param rowNumbers - 처리할 행 번호 배열
   */
  async markPaymentConfirmed(rowNumbers: number[]): Promise<WriteOutcome> {
    return this.write(
      'markPaymentConfirmed',
      rowNumbers,
      () => this.databaseService.markPaymentConfirmed(rowNumbers, 'web'),
      () => this.sheetService!.markPaymentConfirmed(rowNumbers)
    );
  }

  /**
   * 배송완료 처리 (Phase 3)
   * @param rowNumbers - 처리할 행 번호 배열
   * @param trackingNumber - 송장번호 (선택)
   */
  async markDelivered(rowNumbers: number[], trackingNumber?: string): Promise<WriteOutcome> {
    return this.write(
      'markDelivered',
      rowNumbers,
      () => this.databaseService.markDelivered(rowNumbers, trackingNumber, 'web'),
      () => this.sheetService!.markDelivered(rowNumbers, trackingNumber)
    );
  }

  /**
   * 배송완료 처리 - DB ID 기반 (Issue #168: claim 주문용)
   * claim 주문은 DB 전용이므로 시트 업데이트 없이 DB만 업데이트
   * @param dbId - DB ID
   * @param trackingNumber - 송장번호 (선택)
   */
  async markDeliveredById(dbId: number, trackingNumber?: string): Promise<void> {
    if (this.mode === 'sheets') {
      throw new Error('markDeliveredById is not supported in sheets mode. Claim orders require database mode.');
    }

    // database/hybrid 모드 모두 DB만 업데이트 (claim은 DB 전용)
    await this.databaseService.markDeliveredById(dbId, trackingNumber, 'web');
    this.logger?.info(`[${this.mode}] markDeliveredById success: DB id ${dbId}`);
  }

  /**
   * Soft Delete (Phase 3)
   * @param rowNumbers - 삭제할 행 번호 배열
   */
  async softDelete(rowNumbers: number[]): Promise<WriteOutcome> {
    return this.write(
      'softDelete',
      rowNumbers,
      () => this.databaseService.softDelete(rowNumbers, 'web'),
      () => this.sheetService!.softDelete(rowNumbers)
    );
  }

  /**
   * Soft Delete 복원 (Phase 3)
   * @param rowNumbers - 복원할 행 번호 배열
   */
  async restore(rowNumbers: number[]): Promise<WriteOutcome> {
    return this.write(
      'restore',
      rowNumbers,
      () => this.databaseService.restore(rowNumbers, 'web'),
      () => this.sheetService!.restore(rowNumbers)
    );
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
        this.logger?.warn(`[hybrid-fallback] DB getDeletedOrders failed, falling back to Sheets: ${describeError(dbError)}`);
        return this.sheetService!.getDeletedOrders();
      }
      throw dbError;
    }
  }

  /**
   * 주문 정보 수정 (Issue #136)
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
  ): Promise<WriteOutcome> {
    return this.write(
      'updateOrder',
      [rowNumber],
      // Web에서 호출되므로 changedBy='web'
      () => this.databaseService.updateOrder(rowNumber, updates, 'web'),
      () => this.sheetService!.updateOrder(rowNumber, updates)
    );
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
   * 모드별 쓰기 (#197)
   * - sheets · database: 그 저장소 하나에 쓰고 오류는 그대로 전파
   * - hybrid: `hybridWrite`
   */
  private async write(
    operation: string,
    rowNumbers: number[] | undefined,
    dbWrite: () => Promise<void>,
    sheetWrite: () => Promise<void>
  ): Promise<WriteOutcome> {
    if (this.mode === 'sheets') {
      await sheetWrite();
      return writeOk();
    }
    if (this.mode === 'database') {
      await dbWrite();
      return writeOk();
    }
    return this.hybridWrite(operation, rowNumbers, dbWrite, sheetWrite);
  }

  /**
   * hybrid 쓰기 — DB 우선 (#197 · 사용자 결정 2026-11-18)
   *
   * 1. DB(트랜잭션) 실패 → 시트에 쓰지 않고 HybridWriteError(503). 아무것도 바뀌지 않는다
   *    (시트만 반영된 상태는 증분 동기화가 `DB_SYNC_STATUS=success` 행을 건너뛰어 DB 로 회복되지 않는다)
   * 2. DB 성공 · 시트 실패 → Order.syncStatus='failed' 기록 + partial 결과.
   *    그 표시는 다음 쓰기가 성공해도 지우지 않는다 — 쓰기는 일부 필드만 시트에 쓰므로 실패했던 필드가
   *    맞춰졌다는 보장이 없다(PR #230 Codex P2). 행 전체 재조정(#231)이 지운다
   *    DB 가 앞선 상태는 동기화가 충돌로 분류해 DB 값을 유지하므로 안정적이다
   */
  private async hybridWrite(
    operation: string,
    rowNumbers: number[] | undefined,
    dbWrite: () => Promise<void>,
    sheetWrite: () => Promise<void>
  ): Promise<WriteOutcome> {
    const target = rowNumbers ? `rows ${rowNumbers.join(', ')}` : 'all rows';

    try {
      await dbWrite();
    } catch (dbError) {
      this.logger?.error(`[hybrid] ${operation} DB failed — Sheets not written (${target}): ${describeError(dbError)}`);
      throw new HybridWriteError(operation, dbError);
    }

    try {
      await sheetWrite();
    } catch (sheetsError) {
      const reason = `Sheets ${operation}: ${describeError(sheetsError)}`;
      this.logger?.error(`[hybrid-partial] ${operation} Sheets failed after DB success (${target}): ${reason}`);
      await this.recordSheetSyncFailure(rowNumbers, reason);
      return sheetPartial();
    }

    this.logger?.info(`[hybrid] ${operation} DB+Sheets success (${target})`);
    return writeOk();
  }

  /**
   * 시트 반영 실패를 주문에 남긴다 — 기록 실패는 로그만 남긴다(사용자 응답은 이미 partial 이다)
   */
  private async recordSheetSyncFailure(rowNumbers: number[] | undefined, reason: string): Promise<void> {
    if (!rowNumbers || rowNumbers.length === 0) return;
    try {
      await this.databaseService.markSheetSyncFailed(rowNumbers, reason);
    } catch (recordError) {
      this.logger?.error(
        `[hybrid-partial] failed to record sheet sync failure (rows ${rowNumbers.join(', ')}): ${describeError(recordError)}`
      );
    }
  }

  /**
   * ChangeLogService getter (DatabaseService를 통해 접근)
   */
  get changeLogService() {
    return this.databaseService.changeLogService;
  }
}
