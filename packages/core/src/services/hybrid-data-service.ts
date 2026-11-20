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

import { randomUUID } from 'node:crypto';
import type { SheetService } from './sheet-service.js';
import type { DatabaseService } from './database-service.js';
import type { SheetRow, OrderStatus } from '../types/order.js';
import { parseKoreanTimestamp, validateProductSelection } from '../types/order.js';
import { pickSeasonSelection } from '../catalog/form-selection.js';
import type { EditableProductType } from '../types/product-edit.js';
import {
  HybridReadError,
  HybridWriteError,
  SheetRowMismatchError,
  describeError,
  sheetPartial,
  writeOk,
  type WriteOutcome,
} from './hybrid-write.js';
import { matchesSheetRow } from './sheet-row-identity.js';

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

    // database/hybrid: DB에서 직접 조회 — 시트 행이 없는 주문이라 시트 폴백은 없다.
    // #229: DB 오류는 503 + 일반 문구(HybridReadError). 이미 5xx 상태 코드와 문구를 가진 오류는 그대로 둔다(방어용 —
    // 지금 DatabaseService 는 오류를 감싸 다시 던지므로 닿지 않는다). 4xx 는 감싼다 — 원문이 응답에 나가지 않게
    let row: SheetRow | null;
    try {
      row = await this.databaseService.getOrderById(id);
    } catch (error) {
      const statusCode = error && typeof error === 'object' ? (error as { statusCode?: unknown }).statusCode : undefined;
      if (typeof statusCode === 'number' && statusCode >= 500) throw error;
      this.logger?.error(`[hybrid] getOrderById(${id}) failed in DB: ${describeError(error)}`);
      throw new HybridReadError('getOrderById', error);
    }
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
      productType?: EditableProductType;
      quantity?: number;
      /** #317 호출하는 쪽(API)이 이미 찾은 시즌 폼 문구 — 주면 다시 찾지 않는다 */
      seasonSelection?: string | null;
      orderType?: 'customer' | 'gift' | 'claim';
      trackingNumber?: string;
    }
  ): Promise<WriteOutcome> {
    // #317 상품 · 수량 수정이면 같은 시즌 폼 문구를 한 번 찾아 DB · 시트에 같은 값을 넘긴다
    const seasonSelection =
      updates.seasonSelection !== undefined ? updates.seasonSelection : await this.findSeasonSelection(rowNumber, updates);
    // 찾지 못했으면(null) 넘기지 않는다 — 상품을 바꾸는 수정만 resolveProductEdit 이 거절한다
    const resolved = { ...updates, seasonSelection: typeof seasonSelection === 'string' ? seasonSelection : undefined };
    return this.write(
      'updateOrder',
      [rowNumber],
      // Web에서 호출되므로 changedBy='web'
      () => this.databaseService.updateOrder(rowNumber, resolved, 'web'),
      () => this.sheetService!.updateOrder(rowNumber, resolved)
    );
  }

  /**
   * #317 바꿀(또는 지금) 상품의 같은 시즌 폼 문구 — 정본 데이터(sheets 모드는 시트, 그 외는 DB)의 다른 주문 원문에서 찾는다.
   * 상품 · 수량 수정이 아니면 undefined. 찾지 못하면 null — resolveProductEdit 이 필요할 때만 거절한다
   */
  async findSeasonSelection(
    rowNumber: number,
    updates: { productType?: EditableProductType; quantity?: number }
  ): Promise<string | null | undefined> {
    if (updates.productType === undefined && updates.quantity === undefined) return undefined;

    let rows: SheetRow[];
    try {
      rows = await this.getAllRows(true);
    } catch (error) {
      // 읽기 실패로 수량만 고치는 수정까지 막지 않는다 — 상품을 바꾸는 수정은 resolveProductEdit 이 400 으로 거절한다
      const message = error instanceof Error ? error.message : String(error);
      this.logger?.warn(`[product-edit] 같은 시즌 폼 문구를 찾지 못했습니다 (row ${rowNumber}): ${message}`);
      return null;
    }
    const target = rows.find((row) => row._rowNumber === rowNumber);
    if (!target) return null;

    const productType = updates.productType ?? validateProductSelection(String(target['상품 선택'] ?? '')).productType;
    if (!productType) return null;

    const targetTimestamp = parseTimestampOrNull(target['타임스탬프']);
    if (!targetTimestamp) return null;

    const candidates = rows.flatMap((row) => {
      const timestamp = parseTimestampOrNull(row['타임스탬프']);
      return timestamp && row['상품 선택'] ? [{ productSelection: String(row['상품 선택']), timestamp }] : [];
    });
    return pickSeasonSelection(candidates, productType, targetTimestamp);
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
   *    DB 가 앞선 상태는 증분 동기화가 바꾸지 않고(#281) 시트 우선 가져오기도 덮어쓰지 않는다(재조정 대기 · #228)
   * 3. #293 먼저 표시: DB 를 쓰기 전에 대상 행에 "시트 반영 대기" 표시(이번 쓰기 고유값)를 남긴다 — 표시를 못 남기면
   *    아무것도 쓰지 않고 HybridWriteError(503). 시트까지 성공하면 그 고유값일 때만 지운다.
   *    DB 실패면 표시를 남긴다 — 커밋 응답만 유실돼 실제로는 커밋됐을 수 있다(5분 뒤 재조정이 다른 칸만 맞추고 지운다).
   *    시트 실패 · 행 확인 불가면 실패 사유로 덮는다. 그래서 표시 기록 실패 · 중간 종료에도 DB 전용 변경이 표시 없이
   *    남지 않는다. 다른 쓰기의 대기 표시를 만나면 재조정 필요 사유로 바꿔 둔다(#304 — 끝나지 않은 쓰기 · 동시 쓰기)
   */
  private async hybridWrite(
    operation: string,
    rowNumbers: number[] | undefined,
    dbWrite: () => Promise<void>,
    sheetWrite: () => Promise<void>
  ): Promise<WriteOutcome> {
    const target = rowNumbers ? `rows ${rowNumbers.join(', ')}` : 'all rows';

    // #258: 시트 행이 밀렸으면 다른 고객 행에 쓰게 된다 — DB 를 쓰기 전에 확인하고, 다르면 아무것도 쓰지 않는다(throw).
    // 시트를 읽지 못해 확인할 수 없으면 DB 만 쓰고 시트는 쓰지 않는다(부분 저장 · 사용자 결정 2026-11-19)
    const check = await this.checkSheetRows(operation, rowNumbers);

    // #293: DB 를 쓰기 전에 "시트 반영 대기" 표시 — 못 남기면 아무것도 쓰지 않는다
    const pendingRows = rowNumbers ?? [];
    const token = randomUUID();
    try {
      await this.databaseService.markSheetWritePending(pendingRows, token);
    } catch (markError) {
      this.logger?.error(`[hybrid] ${operation} could not mark sheet write pending — nothing written (${target}): ${describeError(markError)}`);
      throw new HybridWriteError(operation, markError);
    }

    try {
      await dbWrite();
    } catch (dbError) {
      // 대기 표시는 남긴다 — 커밋 여부가 불분명할 수 있다(재조정이 맞춘다 · 그동안 시트 우선 가져오기가 덮지 않는다)
      this.logger?.error(`[hybrid] ${operation} DB failed — Sheets not written, pending mark kept (${target}): ${describeError(dbError)}`);
      throw new HybridWriteError(operation, dbError);
    }

    if (check.verified === false) {
      const reason = `Sheets ${operation} skipped — could not verify sheet rows: ${check.reason}`;
      this.logger?.error(`[hybrid-partial] ${reason} (${target})`);
      await this.recordSheetSyncFailure(rowNumbers, reason);
      return sheetPartial();
    }

    try {
      await sheetWrite();
    } catch (sheetsError) {
      const reason = `Sheets ${operation}: ${describeError(sheetsError)}`;
      this.logger?.error(`[hybrid-partial] ${operation} Sheets failed after DB success (${target}): ${reason}`);
      await this.recordSheetSyncFailure(rowNumbers, reason);
      return sheetPartial();
    }

    await this.clearPendingMark(operation, pendingRows, token);
    this.logger?.info(`[hybrid] ${operation} DB+Sheets success (${target})`);
    return writeOk();
  }

  /**
   * #293: 이번 쓰기가 남긴 대기 표시만 지운다 — 실패는 로그만 남긴다(표시가 남으면 재조정이 DB 값을 시트에 다시 쓸 뿐 · 안전)
   */
  private async clearPendingMark(operation: string, rowNumbers: number[], token: string): Promise<void> {
    if (rowNumbers.length === 0) return;
    try {
      await this.databaseService.clearSheetWritePending(rowNumbers, token);
    } catch (clearError) {
      this.logger?.error(
        `[hybrid] ${operation} could not clear the sheet write pending mark (rows ${rowNumbers.join(', ')}) — left for reconcile: ${describeError(clearError)}`
      );
    }
  }

  /**
   * #258: 대상 행들의 시트 `타임스탬프` 를 한 번에 읽어 DB 주문과 같은 주문인지 본다.
   * - DB 에 그 행 번호의 주문이 없으면 불일치로 본다 — 일괄 쓰기의 DB updateMany 는 없는 행을 조용히 건너뛰지만
   *   시트 쓰기는 요청받은 행 전부에 쓰므로, 확인할 수 없는 행에 쓰게 된다(사전 리뷰 M-1)
   * - 시트 값이 비었거나 다른 주문이면 SheetRowMismatchError(409) — 아무것도 쓰지 않는다
   * - 시트(또는 DB)를 읽지 못하면 확인할 수 없다 → `{ verified: false }` — 호출자가 DB 만 쓰고 시트는 건너뛴다
   */
  private async checkSheetRows(
    operation: string,
    rowNumbers: number[] | undefined
  ): Promise<{ verified: true } | { verified: false; reason: string }> {
    if (!rowNumbers || rowNumbers.length === 0 || !this.sheetService) return { verified: true };

    let dbOrders: Map<number, { timestamp: Date; timestampRaw: string | null }>;
    let sheetRaws: Map<number, string>;
    try {
      dbOrders = await this.databaseService.getOrderTimestampsByRows(rowNumbers);
      const toCheck = rowNumbers.filter((n) => dbOrders.has(n));
      sheetRaws = toCheck.length > 0 ? await this.sheetService.getTimestampsByRows(toCheck) : new Map();
    } catch (checkError) {
      return { verified: false, reason: describeError(checkError) };
    }

    const mismatched = rowNumbers.filter((row) => {
      const order = dbOrders.get(row);
      return !order || !matchesSheetRow(order, sheetRaws.get(row));
    });
    if (mismatched.length === 0) return { verified: true };

    this.logger?.error(
      `[hybrid-guard] ${operation} sheet rows do not hold the DB orders (rows ${mismatched.join(', ')}) — nothing written (#258)`
    );
    throw new SheetRowMismatchError(operation, mismatched);
  }

  /**
   * 시트 반영 실패를 주문에 남긴다 — 기록 실패는 로그만 남긴다(사용자 응답은 이미 partial 이다).
   * #293: 실패해도 먼저 남긴 대기 표시가 그대로라 주문은 보호된다(사유만 대기 표시로 남는다)
   */
  private async recordSheetSyncFailure(rowNumbers: number[] | undefined, reason: string): Promise<void> {
    if (!rowNumbers || rowNumbers.length === 0) return;
    try {
      const marked = await this.databaseService.markSheetSyncFailed(rowNumbers, reason);
      if (marked < rowNumbers.length) {
        this.logger?.error(
          `[hybrid-partial] sheet sync failure marked ${marked} of ${rowNumbers.length} rows (rows ${rowNumbers.join(', ')})`
        );
      }
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

/** 시트 타임스탬프 → Date. 읽을 수 없으면 null (#317 시즌 문구 찾기 — 한 행 오류로 수정 전체를 막지 않는다) */
function parseTimestampOrNull(raw: unknown): Date | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  try {
    const date = parseKoreanTimestamp(raw);
    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}
