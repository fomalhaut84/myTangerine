/**
 * SyncEngine
 * Google Sheets → PostgreSQL 동기화 엔진
 *
 * Issue #68 Phase 2.1
 * P1-1: API와 sync-service 간 코드 중복 제거
 */

import type { SheetService } from './sheet-service.js';
import type { DatabaseService } from './database-service.js';
import type { SheetRow } from '../types/order.js';
import {
  isSameOrder,
  parseSheetTimestamp,
  appearsAtOtherRow,
  buildSheetIdentityIndex,
  MAX_ROW_REPLACEMENTS_PER_SYNC,
  ROW_REPLACEMENT_WINDOW_MS,
  type SheetIdentityIndex,
} from './sheet-row-identity.js';
import type { ChangeLogService, FieldChange } from './change-log-service.js';
import type { NewOrderNoticePolicy } from './new-order-notice.js';
import {
  SYNC_STATUS_BATCH_SIZE,
  verifyAndWriteSyncStatuses,
  type PendingSyncStatus,
} from './sync-status-writer.js';

/**
 * 로거 인터페이스 (선택적)
 * Fastify logger 또는 pino logger 모두 지원
 */
export interface Logger {
  info(msg: string, ...args: unknown[]): void;
  info(obj: Record<string, unknown>, msg: string): void;
  debug(msg: string, ...args: unknown[]): void;
  debug(obj: Record<string, unknown>, msg: string): void;
  warn(msg: string, ...args: unknown[]): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(msg: string, ...args: unknown[]): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

/**
 * 싱크 결과 통계
 */
export interface SyncResult {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  conflicts: number;
  errors: Array<{ rowNumber: number; error: string }>;
  conflictDetails: Array<{ rowNumber: number; orderId: number; reason: string }>;
  /** #251: 이번 동기화에서 알림 대기로 표시한 새 주문 수 (정책이 없으면 늘 0) */
  newOrderNotices: number;
  /** #257: 행 번호가 다른 주문에 재사용돼 예전 주문을 분리하고 새로 만든 수 */
  replaced: number;
  /** #257: 교체 상한에 걸려 교체하지 못한 행이 있었다(그 행들은 errors 에 있다) */
  replacementLimitHit: boolean;
  /** #260: 행 정체성 충돌 · 교체 상한으로 쓰지 않은(안전 정지) 행 번호 */
  identityConflictRows: number[];
  /** #261: 상태 칸을 쓰기 전 · 후 확인에서 시트 행이 스냅샷과 달라(행 밀림) 이번 실행을 멈췄다 */
  rowShiftDetected: boolean;
  /** #261: 멈춰서 처리하지 못한 행 수(DB 반영도 안 했다 · 다음 실행이 처리) — 멈추지 않았으면 0 */
  unprocessed: number;
}

/** 행 하나의 동기화 결과 */
interface SyncRowResult {
  success: boolean;
  orderId?: number;
  error?: string;
  conflict?: boolean;
  conflictReason?: string;
  newOrderNotice?: boolean;
  replaced?: boolean;
  /** #260: 행 정체성 충돌 · 교체 상한으로 쓰지 않았다 */
  identityConflict?: boolean;
  /** #261: 시트 상태 칸에 쓸 내용 — 바로 쓰지 않고 performSync 가 묶어 확인 뒤 쓴다 */
  statusWrite?: { status: 'success' | 'fail'; orderId?: number; syncedAt: Date };
}

/** #261: 상태 칸 쓰기를 기다리는 행 — 쓰기 결과에 따라 행 결과가 확정된다 */
interface PendingRow {
  entry: PendingSyncStatus;
  rowResult: SyncRowResult;
}

/** #257: 한 번의 동기화 실행 동안 공유하는 상태 */
interface SyncRunContext {
  /**
   * #281: incremental = 새 주문만 만든다(기존 주문의 DB 값은 바꾸지 않는다 · hybrid 정본 = DB)
   * full = 시트 우선 가져오기(운영자 복구) — 기존 주문도 시트 값으로 덮어쓰고 변경 이력을 남긴다
   */
  mode: 'incremental' | 'full';
  /** 이번 시트 스냅샷의 물리 행 전체(삭제됨 · 필수 정보 빠진 행 포함) 정체성 색인 (#264) */
  sheetIndex: SheetIdentityIndex;
  /** 이번 실행의 교체 수 */
  replacements: number;
  /** 최근 창(24시간) 동안 이전 실행들이 한 교체 수 — 첫 교체 때 한 번 읽는다 */
  recentReplacements: number | null;
  /** 이번 실행에서 상한 때문에 교체하지 못한 행이 있었다 */
  replacementLimitHit: boolean;
}

/** #257 · #260: 시트 행과 DB 주문의 정체성이 맞지 않아 그 행을 쓰지 않았다(행 밀림 · 중복 방지) */
export class RowIdentityConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RowIdentityConflictError';
  }
}

/** #257: 행 재사용 교체가 상한(최근 24시간)을 넘었다 — 그 행은 교체하지 않고 실패로 남긴다 */
export class RowReplacementLimitError extends Error {
  constructor(rowNumber: number) {
    super(
      `Row replacement limit (${MAX_ROW_REPLACEMENTS_PER_SYNC} per 24h) reached at row ${rowNumber} — not replacing to avoid mass changes (#257)`
    );
    this.name = 'RowReplacementLimitError';
  }
}

/** SyncEngine 옵션 */
export interface SyncEngineOptions {
  /** #251: 있으면 새로 만드는 주문에 알림 대기 표시 — sync-service(cron)만 넘긴다 */
  newOrderNotice?: NewOrderNoticePolicy;
}

/**
 * 싱크 엔진 클래스
 */
export class SyncEngine {
  private logger?: Logger;
  private changeLogService?: ChangeLogService;

  constructor(
    private sheetService: SheetService,
    private databaseService: DatabaseService,
    logger?: Logger,
    changeLogService?: ChangeLogService,
    private readonly options: SyncEngineOptions = {}
  ) {
    this.logger = logger;
    this.changeLogService = changeLogService;
  }

  /**
   * KST ISO 8601 타임스탬프 파싱
   * @param timestamp - "2024-02-01T21:34:56+09:00" 형식
   * @returns Date 객체 또는 null
   */
  private parseKstTimestamp(timestamp: string | undefined | null): Date | null {
    if (!timestamp) return null;

    try {
      const date = new Date(timestamp);
      return isNaN(date.getTime()) ? null : date;
    } catch {
      return null;
    }
  }

  /**
   * 시트 데이터와 DB 데이터의 차이 계산
   */
  private calculateSheetDbDifferences(
    sheetRow: SheetRow,
    dbOrder: Record<string, unknown>
  ): Record<string, FieldChange> {
    const changes: Record<string, FieldChange> = {};

    // 비교할 필드 매핑 (시트 컬럼명 → Prisma Order 필드명)
    // 5차 리뷰: address → recipientAddress 수정 (Prisma 스키마와 일치)
    const fieldMapping: Record<string, string> = {
      '받으실분 성함': 'recipientName',
      '받으실분 연락처 (핸드폰번호)': 'recipientPhone',
      '받으실분 주소 (도로명 주소로 부탁드려요)': 'recipientAddress',
      '보내는분 성함': 'senderName',
      '보내는분 연락처 (핸드폰번호)': 'senderPhone',
      '보내는분 주소 (도로명 주소로 부탁드려요)': 'senderAddress',
      '5kg 수량': 'quantity5kg',
      '10kg 수량': 'quantity10kg',
    };

    for (const [sheetCol, dbField] of Object.entries(fieldMapping)) {
      const sheetValue = sheetRow[sheetCol];
      const dbValue = dbOrder[dbField];

      // 9차 + 10차 리뷰: quantity 필드는 '', '0', 0, null, undefined를 동등하게 처리
      // DB는 '0'으로 저장하고 Sheets는 ''로 저장할 수 있으므로 정규화 필요
      // 10차 리뷰: 숫자 타입도 문자열로 정규화하여 타입 차이로 인한 false positive 방지
      const isQuantityField = dbField === 'quantity5kg' || dbField === 'quantity10kg';

      let normalizedSheet = sheetValue === undefined || sheetValue === '' ? null : sheetValue;
      let normalizedDb = dbValue === undefined || dbValue === '' ? null : dbValue;

      // quantity 필드에서 '0', 0도 null로 처리하고, 숫자는 문자열로 변환
      if (isQuantityField) {
        if (normalizedSheet === '0' || normalizedSheet === 0) normalizedSheet = null;
        else if (typeof normalizedSheet === 'number') normalizedSheet = String(normalizedSheet);

        if (normalizedDb === '0' || normalizedDb === 0) normalizedDb = null;
        else if (typeof normalizedDb === 'number') normalizedDb = String(normalizedDb);
      }

      if (JSON.stringify(normalizedSheet) !== JSON.stringify(normalizedDb)) {
        changes[dbField] = {
          old: normalizedDb,
          new: normalizedSheet,
        };
      }
    }

    return changes;
  }

  /**
   * 단일 행 동기화
   * @param row - SheetRow 데이터
   * @returns 성공 여부, order ID, 에러 메시지, 충돌 여부
   */
  private async syncRow(row: SheetRow, ctx: SyncRunContext): Promise<SyncRowResult> {
    const rowNumber = row._rowNumber;

    if (!rowNumber) {
      this.logger?.warn({ row }, 'Row has no _rowNumber, skipping');
      return { success: false, error: 'Missing _rowNumber' };
    }

    try {
      // Phase 2: Raw Prisma Order 조회 (충돌 감지에 필요한 메타 필드 포함)
      const existingOrder = await this.databaseService.getRawOrderByRowNumber(rowNumber);

      // #257: 같은 행 번호의 DB 주문이 다른 주문이면(시트 행 삭제 뒤 번호 재사용) 덮어쓰지 않는다
      if (existingOrder && !isSameOrder(existingOrder, row['타임스탬프'])) {
        return await this.replaceReusedRow(existingOrder, row, rowNumber, ctx);
      }
      if (!existingOrder) {
        await this.assertNotDuplicate(row, rowNumber);
      }

      // #281: 증분 동기화는 DB 에 있는 같은 주문을 바꾸지 않는다 — 시트 상태 칸만 쓴다
      if (existingOrder && ctx.mode === 'incremental') {
        return {
          success: true,
          orderId: existingOrder.id,
          statusWrite: { status: 'success', orderId: existingOrder.id, syncedAt: new Date() },
        };
      }

      // #281: 시트 우선 가져오기도 DB 에만 있는 변경(시트 반영 실패)은 덮어쓰지 않는다 — 재조정(#231) 대상
      if (existingOrder?.syncStatus === 'failed') {
        const conflictReason =
          'DB has changes not yet written to the sheet (syncStatus=failed) — not overwritten by sheet-first import (#281)';
        this.logger?.warn({ rowNumber, orderId: existingOrder.id }, conflictReason);
        return { success: true, orderId: existingOrder.id, conflict: true, conflictReason };
      }

      const attemptCount = existingOrder ? (existingOrder.syncAttemptCount || 0) + 1 : 1;

      // 충돌 감지: DB가 'web'에서 수정되었고, 시트보다 최신인 경우
      // 참고: 'api' 수정은 충돌 감지 대상이 아님 (api는 권위있는 소스로 간주하여 시트 덮어쓰기 허용)
      if (existingOrder?.lastModifiedBy === 'web' && existingOrder.lastModifiedAt) {
        const sheetSyncAt = this.parseKstTimestamp(row['DB_SYNC_AT'] as string);

        if (sheetSyncAt && existingOrder.lastModifiedAt > sheetSyncAt) {
          // 충돌 발생 - 덮어쓰기 중단
          const conflictReason = `DB modified at ${existingOrder.lastModifiedAt.toISOString()} > Sheet sync at ${sheetSyncAt.toISOString()}`;

          this.logger?.warn(
            { rowNumber, orderId: existingOrder.id, conflictReason },
            'Conflict detected: DB was modified by web after last sync'
          );

          // 11차 리뷰: 미해결 충돌 로그가 이미 있으면 중복 생성 방지
          if (this.changeLogService) {
            const hasUnresolvedConflict = await this.changeLogService.hasUnresolvedConflict(existingOrder.id);

            if (!hasUnresolvedConflict) {
              // Phase 2: Prisma Order를 Record로 변환하여 차이 계산
              const fieldChanges = this.calculateSheetDbDifferences(row, existingOrder as unknown as Record<string, unknown>);

              await this.changeLogService.logChange({
                orderId: existingOrder.id,
                sheetRowNumber: rowNumber,
                changedBy: 'sync',
                action: 'conflict_detected',
                fieldChanges,
                previousVersion: existingOrder.version ?? 1,
                conflictDetected: true,
                // conflictResolution은 null로 시작 (미해결 상태)
                // API를 통해 수동으로 해결 처리 필요
              });
            } else {
              this.logger?.debug(
                { rowNumber, orderId: existingOrder.id },
                'Skipping conflict log: unresolved conflict already exists'
              );
            }
          }

          return {
            success: true, // 충돌은 정상적인 처리로 간주
            orderId: existingOrder.id,
            conflict: true,
            conflictReason,
          };
        }
      }

      // 충돌 없음 - DB에 upsert
      // #251: 알림 정책은 DB 에 아직 없는 행(새로 만들어지는 주문)에만 넘긴다
      const noticePolicy = !existingOrder ? this.options.newOrderNotice : undefined;
      const order = await this.databaseService.upsertOrder(
        row,
        { syncStatus: 'success', syncAttemptCount: attemptCount },
        noticePolicy ? { newOrderNotice: noticePolicy } : undefined
      );
      const newOrderNotice = Boolean(noticePolicy) && order.newOrderNotice === 'pending';

      this.logger?.debug({ rowNumber, orderId: order.id, attemptCount }, 'DB upsert successful');

      // #281: 시트 우선 가져오기가 기존 주문을 덮어썼으면 바뀐 필드를 변경 이력에 남긴다
      if (existingOrder) {
        await this.logSheetFirstOverwrite(existingOrder, row, rowNumber);
      }

      // #261: 시트 상태 칸은 performSync 가 묶어 행 확인 뒤 쓴다(쓰기 실패는 그때 이 행의 실패로 바뀐다)
      return { success: true, orderId: order.id, newOrderNotice, statusWrite: { status: 'success', orderId: order.id, syncedAt: new Date() } };
    } catch (dbError) {
      // DB upsert 실패
      const dbMessage = dbError instanceof Error ? dbError.message : String(dbError);
      this.logger?.error({ rowNumber, error: dbMessage }, 'DB upsert failed');

      // #260: 행 정체성 문제(안전 정지)는 결과에 따로 모아 알림이 쓰게 한다
      const identityConflict = dbError instanceof RowIdentityConflictError || dbError instanceof RowReplacementLimitError;
      // 시트에 fail 기록 — #261: 이것도 묶어 행 확인 뒤 쓴다
      return { success: false, error: `DB upsert failed: ${dbMessage}`, identityConflict, statusWrite: { status: 'fail', syncedAt: new Date() } };
    }
  }

  /**
   * #257: 같은 행 번호의 DB 주문이 다른 주문일 때(시트 행 번호가 바뀜).
   * - 예전 주문이 이번 시트의 **다른 행에 아직 있거나**, 이 행의 주문이 DB 다른 행에 이미 있으면 → 행이 밀렸다.
   *   아무것도 쓰지 않고 실패(안전 정지 · 재정렬은 사람이 — 런북)
   * - 예전 주문이 시트 어디에도 없으면(정말 지워짐) → 예전 주문 분리·삭제 처리 + 새 주문 생성(한 트랜잭션)
   * - 교체는 한 번의 동기화에서 MAX_ROW_REPLACEMENTS_PER_SYNC 건까지 — 넘으면 동기화 전체를 멈춘다
   * 실패는 syncRow 의 기존 catch(시트 DB_SYNC_STATUS=fail)로 간다.
   */
  private async replaceReusedRow(
    existing: { id: number; timestamp: Date; timestampRaw: string | null; version: number | null; deletedAt: Date | null },
    row: SheetRow,
    rowNumber: number,
    ctx: SyncRunContext
  ): Promise<SyncRowResult> {
    await this.assertNotShifted(existing, row, rowNumber, ctx);

    if (ctx.recentReplacements === null) {
      ctx.recentReplacements = await this.databaseService.countRecentRowReplacements(
        new Date(Date.now() - ROW_REPLACEMENT_WINDOW_MS)
      );
    }
    if (ctx.recentReplacements + ctx.replacements >= MAX_ROW_REPLACEMENTS_PER_SYNC) {
      // 이 행만 교체하지 않고 실패로 남긴다 — 다른 행(일반 신규 주문)은 계속 동기화된다
      ctx.replacementLimitHit = true;
      this.logger?.error({ rowNumber, existingOrderId: existing.id }, 'Row replacement limit reached — not replacing (#257)');
      throw new RowReplacementLimitError(rowNumber);
    }
    ctx.replacements++;

    const policy = this.options.newOrderNotice;
    const order = await this.databaseService.replaceOrderAtRow(
      { id: existing.id, version: existing.version, deletedAt: existing.deletedAt },
      row,
      { syncStatus: 'success', syncAttemptCount: 1 },
      policy ? { newOrderNotice: policy } : undefined
    );
    const newOrderNotice = Boolean(policy) && order.newOrderNotice === 'pending';
    this.logger?.warn(
      { rowNumber, detachedOrderId: existing.id, newOrderId: order.id },
      'Sheet row reused by a different order — detached the old order and created a new one (#257)'
    );

    return {
      success: true,
      orderId: order.id,
      newOrderNotice,
      replaced: true,
      statusWrite: { status: 'success', orderId: order.id, syncedAt: new Date() },
    };
  }

  /**
   * #281: 시트 우선 가져오기가 기존 주문을 시트 값으로 덮어쓴 필드를 변경 이력(sync · update)에 남긴다.
   * 덮어쓰기는 이미 끝났으므로 이력 기록 실패는 행을 실패로 만들지 않고 로그만 남긴다.
   */
  private async logSheetFirstOverwrite(
    existing: { id: number; version: number | null } & Record<string, unknown>,
    row: SheetRow,
    rowNumber: number
  ): Promise<void> {
    if (!this.changeLogService) return;
    const fieldChanges = this.calculateSheetDbDifferences(row, existing);
    if (Object.keys(fieldChanges).length === 0) return;
    try {
      await this.changeLogService.logChange({
        orderId: existing.id,
        sheetRowNumber: rowNumber,
        changedBy: 'sync',
        action: 'update',
        fieldChanges,
        previousVersion: existing.version ?? 1,
      });
    } catch (error) {
      this.logger?.error(
        { rowNumber, orderId: existing.id, error: error instanceof Error ? error.message : String(error) },
        'Sheet-first import overwrote the order but failed to record change history (#281)'
      );
    }
  }

  /** #257: 이 시트 행의 주문이 DB 다른 행에 이미 있으면 그 id */
  private async findThisRowsOrderElsewhere(row: SheetRow, rowNumber: number): Promise<number | null> {
    const raw = row['타임스탬프'];
    if (!raw || !raw.trim()) return null;
    return this.databaseService.findOrderAtOtherRow(raw, parseSheetTimestamp(raw), rowNumber);
  }

  /**
   * #257: DB 에 이 행 번호의 주문이 없어 새로 만들기 전 — 같은 주문이 DB 다른 행에 있으면(밀린 행의 끝 · 전체 동기화) 중복을 만들지 않는다
   */
  private async assertNotDuplicate(row: SheetRow, rowNumber: number): Promise<void> {
    const otherId = await this.findThisRowsOrderElsewhere(row, rowNumber);
    if (otherId === null) return;
    this.logger?.error(
      { rowNumber, matchingOrderId: otherId },
      'Row identity conflict: this order already exists at another row — not creating a duplicate (#257)'
    );
    throw new RowIdentityConflictError(
      `Row identity conflict: row ${rowNumber}'s order already exists as DB #${otherId} at another row — sheet rows shifted? (not creating a duplicate)`
    );
  }

  /** #257: 행이 밀린 신호가 있으면 throw (쓰지 않음) */
  private async assertNotShifted(
    existing: { id: number; timestampRaw: string | null },
    row: SheetRow,
    rowNumber: number,
    ctx: SyncRunContext
  ): Promise<void> {
    const oldStillInSheet = appearsAtOtherRow(ctx.sheetIndex, existing.timestampRaw, rowNumber);
    const movedId = await this.findThisRowsOrderElsewhere(row, rowNumber);
    if (!oldStillInSheet && movedId === null) return;

    this.logger?.error(
      { rowNumber, existingOrderId: existing.id, oldStillInSheet, matchingOrderId: movedId },
      'Row identity conflict: sheet rows look shifted — not writing (#257)'
    );
    throw new RowIdentityConflictError(
      `Row identity conflict: row ${rowNumber} no longer holds DB #${existing.id}` +
        (oldStillInSheet ? ' (that order is at another sheet row)' : '') +
        (movedId !== null ? ` (this row's order is DB #${movedId})` : '') +
        ' — sheet rows shifted?'
    );
  }

  /** 행 결과를 실행 결과에 센다 */
  private recordRowResult(result: SyncResult, rowNumber: number, rowResult: SyncRowResult): void {
    const { success, error, conflict, conflictReason, orderId, newOrderNotice, replaced, identityConflict } = rowResult;
    if (newOrderNotice) result.newOrderNotices++;
    if (replaced) result.replaced++;
    if (identityConflict) result.identityConflictRows.push(rowNumber);

    if (conflict && orderId) {
      // 충돌 감지 - 별도 카운트
      result.conflicts++;
      result.conflictDetails.push({
        rowNumber,
        orderId,
        reason: conflictReason || 'Web modification detected',
      });
    } else if (success) {
      result.success++;
    } else {
      result.failed++;
      result.errors.push({
        rowNumber,
        error: error || 'Unknown error',
      });
    }
  }

  /**
   * #261: 모아 둔 상태 칸을 행 확인 뒤 쓰고 그 행들의 결과를 확정한다.
   * @returns false = 시트 행이 스냅샷과 달라(행 밀림) 멈춰야 한다 — 호출자는 이번 실행을 멈춘다
   */
  private async flushSyncStatuses(batch: readonly PendingRow[], result: SyncResult): Promise<boolean> {
    if (batch.length === 0) return true;
    const rows = batch.map((p) => p.entry.rowNumber);
    const outcome = await verifyAndWriteSyncStatuses(
      this.sheetService,
      batch.map((p) => p.entry)
    );

    switch (outcome.kind) {
      case 'written': {
        if ('postCheckError' in outcome) {
          this.logger?.warn({ rows, error: outcome.postCheckError }, 'Sheets sync status written, but post-write row check failed');
        } else {
          this.logger?.debug({ rows }, 'Sheets sync status updated');
        }
        batch.forEach((p) => this.recordRowResult(result, p.entry.rowNumber, p.rowResult));
        return true;
      }
      case 'failed': {
        // 지금까지의 시트 쓰기 실패와 같다 — DB 는 반영됐고 상태 칸만 못 썼다(다음 증분 동기화가 다시 처리)
        this.logger?.error(
          { rows, stage: outcome.stage, error: outcome.error },
          outcome.stage === 'write'
            ? 'Sheets sync status write failed — some cells may have been written'
            : 'Sheets sync status not written: row check read failed'
        );
        batch.forEach((p) =>
          this.recordRowResult(result, p.entry.rowNumber, {
            ...p.rowResult,
            success: false,
            error: p.rowResult.success
              ? `Sheets update failed: ${outcome.error}`
              : `${p.rowResult.error}; fail status not written: ${outcome.error}`,
          })
        );
        return true;
      }
      case 'shifted':
      case 'writtenThenShifted': {
        const written = outcome.kind === 'writtenThenShifted';
        const reason = written
          ? `Sheet row ${outcome.mismatchedRows[0]} changed right after writing — DB_SYNC_* may have been written onto shifted rows ` +
            `${rows.join(', ')}; check them, sync stopped (#261)`
          : `Sheet row ${outcome.mismatchedRows[0]} no longer matches this sync's snapshot — rows shifted during sync? ` +
            'DB_SYNC_* not written, sync stopped (#261)';
        this.logger?.error(
          { rows, mismatchedRows: outcome.mismatchedRows, written },
          'Row identity conflict around sync status write: sheet rows shifted — stopping this sync (#261)'
        );
        batch.forEach((p) =>
          this.recordRowResult(result, p.entry.rowNumber, {
            ...p.rowResult,
            success: false,
            conflict: false,
            identityConflict: true,
            error: p.rowResult.success ? reason : `${p.rowResult.error}; ${reason}`,
          })
        );
        result.rowShiftDetected = true;
        return false;
      }
    }
  }

  /**
   * 공통 동기화 로직
   * @param skipSynced - true면 이미 동기화된 행 스킵 (증분), false면 모두 재동기화 (전체)
   * @param mode - 로그용 모드 이름
   */
  private async performSync(skipSynced: boolean, mode: string): Promise<SyncResult> {
    this.logger?.info(`Starting ${mode} sync...`);

    const result: SyncResult = {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      conflicts: 0,
      errors: [],
      conflictDetails: [],
      newOrderNotices: 0,
      replaced: 0,
      replacementLimitHit: false,
      identityConflictRows: [],
      rowShiftDetected: false,
      unprocessed: 0,
    };

    try {
      // 모든 행 가져오기
      // #264: 처리 대상과 행 밀림 판정 색인(거르지 않은 물리 행 전체)을 같은 응답 하나에서
      const { rows: allRows, physical } = await this.sheetService.getAllRowsSnapshot();
      // #257: 이번 시트 스냅샷의 정체성 색인 · 교체 건수(차단기)
      const ctx: SyncRunContext = {
        mode: skipSynced ? 'incremental' : 'full',
        sheetIndex: buildSheetIdentityIndex(physical),
        replacements: 0,
        recentReplacements: null,
        replacementLimitHit: false,
      };
      result.total = allRows.length;

      this.logger?.info({ total: result.total }, 'Fetched rows from Google Sheets');

      // 각 행 동기화 — #261: 상태 칸은 SYNC_STATUS_BATCH_SIZE 행씩 모아 행 확인 뒤 쓴다
      let pending: PendingRow[] = [];
      let shifted = false;
      try {
        for (const [index, row] of allRows.entries()) {
          const rowNumber = row._rowNumber;

          if (!rowNumber) {
            result.skipped++;
            continue;
          }

          // 증분 모드에서만 DB_SYNC_STATUS 확인
          if (skipSynced) {
            const syncStatus = row['DB_SYNC_STATUS'];
            if (syncStatus === 'success') {
              this.logger?.debug({ rowNumber, syncStatus }, 'Row already synced successfully, skipping');
              result.skipped++;
              continue;
            }
          }

          // 행 동기화
          const rowResult = await this.syncRow(row, ctx);
          if (rowResult.statusWrite) {
            pending = [
              ...pending,
              {
                entry: { rowNumber, ...rowResult.statusWrite, snapshotTimestamp: String(row['타임스탬프'] ?? '') },
                rowResult,
              },
            ];
          } else {
            this.recordRowResult(result, rowNumber, rowResult);
          }

          if (pending.length >= SYNC_STATUS_BATCH_SIZE) {
            const batch = pending;
            pending = [];
            if (!(await this.flushSyncStatuses(batch, result))) {
              shifted = true;
              result.unprocessed = allRows.length - (index + 1);
              break;
            }
          }

          // Rate limiting: Google Sheets API quota 준수를 위해 1초 대기
          // (60 requests/minute 제한을 초과하지 않도록)
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (loopError) {
        // syncRow · flush 는 오류를 결과로 바꾸므로 여기 오면 불변식이 깨진 것 — 묶어 둔 행은 DB 에 반영됐고 상태 칸만 비어 있다
        this.logger?.error(
          {
            pendingRows: pending.map((p) => p.entry.rowNumber),
            success: result.success,
            failed: result.failed,
            error: loopError instanceof Error ? loopError.message : String(loopError),
          },
          `${mode} sync aborted with unflushed sync statuses — rows are in DB, DB_SYNC_* left blank (next run retries)`
        );
        throw loopError;
      }

      if (!shifted && !(await this.flushSyncStatuses(pending, result))) {
        shifted = true;
      }

      if (shifted) {
        this.logger?.warn(
          {
            success: result.success,
            failed: result.failed,
            skipped: result.skipped,
            conflicts: result.conflicts,
            unprocessed: result.unprocessed,
            identityConflictRows: result.identityConflictRows,
          },
          `${mode} sync stopped: sheet rows shifted during sync (#261) — see docs/runbooks/sheet-sync-operations.md`
        );
      }

      result.replacementLimitHit = ctx.replacementLimitHit;

      this.logger?.info(
        { success: result.success, failed: result.failed, skipped: result.skipped, conflicts: result.conflicts },
        `${mode} sync completed`
      );

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger?.error({ error: message }, `${mode} sync failed`);
      throw new Error(`${mode} sync failed: ${message}`);
    }
  }

  /**
   * 증분 동기화 (기본 모드 · cron)
   * DB_SYNC_STATUS가 'success'인 행은 스킵. #281: 새 주문만 만들고 기존 주문의 DB 값은 바꾸지 않는다(hybrid 정본 = DB)
   */
  async incrementalSync(): Promise<SyncResult> {
    return this.performSync(true, 'incremental');
  }

  /**
   * 시트 우선 전체 가져오기 (운영자 복구 · #281)
   * 모든 행을 다시 읽어 기존 주문도 시트 값으로 덮어쓴다 — 바뀐 필드는 변경 이력에 남고,
   * 시트 반영 실패(syncStatus=failed) · 웹 수정 충돌 주문은 덮어쓰지 않는다. 최초 입력값은 바꾸지 않는다.
   * DB 장애 · sheets 모드 운영 뒤 DB 를 시트에 맞출 때만 쓴다.
   */
  async fullResync(): Promise<SyncResult> {
    return this.performSync(false, 'full');
  }
}
