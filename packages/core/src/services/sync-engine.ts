/**
 * SyncEngine
 * Google Sheets → PostgreSQL 동기화 엔진
 *
 * Issue #68 Phase 2.1
 * P1-1: API와 sync-service 간 코드 중복 제거
 */

import type { SheetService } from './sheet-service.js';
import type { DatabaseService } from './database-service.js';
import { parseKoreanTimestamp, type SheetRow } from '../types/order.js';
import type { ChangeLogService, FieldChange } from './change-log-service.js';
import type { NewOrderNoticePolicy } from './new-order-notice.js';

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
   * KST (UTC+9) 타임스탬프를 ISO 8601 형식으로 포맷
   * @param date - Date 객체
   * @returns "2024-02-01T21:34:56+09:00" 형식의 문자열
   */
  private formatKstTimestamp(date: Date): string {
    const kstOffset = 9 * 60; // +9시간 (분 단위)
    const utcTime = date.getTime() + date.getTimezoneOffset() * 60 * 1000;
    const kstTime = new Date(utcTime + kstOffset * 60 * 1000);

    const year = kstTime.getFullYear();
    const month = String(kstTime.getMonth() + 1).padStart(2, '0');
    const day = String(kstTime.getDate()).padStart(2, '0');
    const hours = String(kstTime.getHours()).padStart(2, '0');
    const minutes = String(kstTime.getMinutes()).padStart(2, '0');
    const seconds = String(kstTime.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+09:00`;
  }

  /**
   * Sheets의 싱크 상태 필드 업데이트 (배치 업데이트)
   * @param rowNumber - 행 번호
   * @param status - 'success' | 'fail'
   * @param orderId - DB의 order ID (선택)
   * @throws 업데이트 실패 시 에러 throw (호출자가 처리)
   */
  private async updateSheetSyncStatus(
    rowNumber: number,
    status: 'success' | 'fail',
    orderId?: number
  ): Promise<void> {
    // KST (UTC+9) 시간으로 ISO 8601 형식 저장
    // 형식: "2024-02-01T21:34:56+09:00"
    const syncTime = this.formatKstTimestamp(new Date());

    const updates: Record<string, string> = {
      DB_SYNC_STATUS: status,
      DB_SYNC_AT: syncTime,
    };

    // DB_SYNC_ID 설정 (성공 시만, 실패 시는 빈 문자열)
    if (status === 'success' && orderId !== undefined) {
      updates.DB_SYNC_ID = String(orderId);
    } else if (status === 'fail') {
      updates.DB_SYNC_ID = '';
    }

    // 배치 업데이트로 한 번에 처리 (3개 API 호출 → 1개로 감소)
    await this.sheetService.updateRowCells(rowNumber, updates);
  }

  /**
   * 단일 행 동기화
   * @param row - SheetRow 데이터
   * @returns 성공 여부, order ID, 에러 메시지, 충돌 여부
   */
  private async syncRow(row: SheetRow): Promise<{
    success: boolean;
    orderId?: number;
    error?: string;
    conflict?: boolean;
    conflictReason?: string;
    newOrderNotice?: boolean;
    replaced?: boolean;
  }> {
    const rowNumber = row._rowNumber;

    if (!rowNumber) {
      this.logger?.warn({ row }, 'Row has no _rowNumber, skipping');
      return { success: false, error: 'Missing _rowNumber' };
    }

    try {
      // Phase 2: Raw Prisma Order 조회 (충돌 감지에 필요한 메타 필드 포함)
      const existingOrder = await this.databaseService.getRawOrderByRowNumber(rowNumber);

      // #257: 같은 행 번호의 DB 주문이 다른 주문이면(시트 행 삭제 뒤 번호 재사용) 덮어쓰지 않는다
      if (existingOrder && this.isDifferentOrder(existingOrder, row)) {
        return await this.replaceReusedRow(existingOrder, row, rowNumber);
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

      try {
        // Sheets 싱크 필드 업데이트
        await this.updateSheetSyncStatus(rowNumber, 'success', order.id);
        this.logger?.debug({ rowNumber }, 'Sheets sync status updated');

        return { success: true, orderId: order.id, newOrderNotice };
      } catch (sheetError) {
        // DB upsert 성공, Sheets 업데이트 실패
        const sheetMessage = sheetError instanceof Error ? sheetError.message : String(sheetError);
        this.logger?.error(
          { rowNumber, orderId: order.id, error: sheetMessage },
          'DB upsert succeeded but Sheets update failed'
        );

        // DB 에는 만들어졌으므로 알림 표시도 남아 있다 — 건수에 넣는다
        return {
          success: false,
          orderId: order.id,
          error: `Sheets update failed: ${sheetMessage}`,
          newOrderNotice,
        };
      }
    } catch (dbError) {
      // DB upsert 실패
      const dbMessage = dbError instanceof Error ? dbError.message : String(dbError);
      this.logger?.error({ rowNumber, error: dbMessage }, 'DB upsert failed');

      try {
        // Sheets에 fail 상태 기록
        await this.updateSheetSyncStatus(rowNumber, 'fail');
      } catch (sheetError) {
        // Sheets 업데이트도 실패
        const sheetMessage = sheetError instanceof Error ? sheetError.message : String(sheetError);
        this.logger?.error(
          { rowNumber, error: sheetMessage },
          'Failed to update Sheets with fail status'
        );
      }

      return { success: false, error: `DB upsert failed: ${dbMessage}` };
    }
  }

  /**
   * #257: 시트 행과 같은 행 번호의 DB 주문이 다른 주문인지 — 주문 시각으로 가린다(웹은 타임스탬프를 바꾸지 않는다).
   * 시트 시각을 읽을 수 없으면 판정하지 않는다(false — 기존처럼 갱신).
   */
  private isDifferentOrder(existing: { timestamp: Date }, row: SheetRow): boolean {
    const rowTime = this.parseRowTimestamp(row);
    if (!rowTime) return false;
    return existing.timestamp.getTime() !== rowTime.getTime();
  }

  private parseRowTimestamp(row: SheetRow): Date | null {
    const raw = row['타임스탬프'];
    if (!raw) return null;
    try {
      const parsed = parseKoreanTimestamp(raw);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    } catch {
      return null;
    }
  }

  /**
   * #257: 재사용된 행 처리.
   * - 그 시각의 주문이 DB 다른 행에 이미 있으면(행이 밀림) 쓰지 않고 실패 — 안전 정지(재정렬은 범위 밖)
   * - 없으면 예전 주문을 분리·삭제 처리하고 새 주문을 만든다(한 트랜잭션) → 시트에 새 id 로 성공 기록
   * 실패는 syncRow 의 기존 catch(시트 DB_SYNC_STATUS=fail)로 간다.
   */
  private async replaceReusedRow(
    existing: { id: number; timestamp: Date; version: number | null; deletedAt: Date | null },
    row: SheetRow,
    rowNumber: number
  ): Promise<{ success: boolean; orderId?: number; error?: string; newOrderNotice?: boolean; replaced?: boolean }> {
    const rowTime = this.parseRowTimestamp(row) as Date; // isDifferentOrder 가 확인했다
    const movedId = await this.databaseService.findSyncedOrderIdByTimestamp(rowTime, rowNumber);
    if (movedId !== null) {
      this.logger?.error(
        { rowNumber, existingOrderId: existing.id, matchingOrderId: movedId },
        'Row identity conflict: sheet rows look shifted — not writing (#257)'
      );
      throw new Error(
        `Row identity conflict: row ${rowNumber} holds the order of DB #${movedId}, not #${existing.id} (sheet rows shifted?)`
      );
    }

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

    try {
      await this.updateSheetSyncStatus(rowNumber, 'success', order.id);
      return { success: true, orderId: order.id, newOrderNotice, replaced: true };
    } catch (sheetError) {
      const sheetMessage = sheetError instanceof Error ? sheetError.message : String(sheetError);
      this.logger?.error({ rowNumber, orderId: order.id, error: sheetMessage }, 'DB replace succeeded but Sheets update failed');
      return { success: false, orderId: order.id, error: `Sheets update failed: ${sheetMessage}`, newOrderNotice, replaced: true };
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
    };

    try {
      // 모든 행 가져오기
      const allRows = await this.sheetService.getAllRows();
      result.total = allRows.length;

      this.logger?.info({ total: result.total }, 'Fetched rows from Google Sheets');

      // 각 행 동기화
      for (const row of allRows) {
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
        const { success, error, conflict, conflictReason, orderId, newOrderNotice, replaced } = await this.syncRow(row);
        if (newOrderNotice) result.newOrderNotices++;
        if (replaced) result.replaced++;

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

        // Rate limiting: Google Sheets API quota 준수를 위해 1초 대기
        // (60 requests/minute 제한을 초과하지 않도록)
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

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
   * 증분 동기화 (기본 모드)
   * DB_SYNC_STATUS가 'success'인 행은 스킵
   */
  async incrementalSync(): Promise<SyncResult> {
    return this.performSync(true, 'incremental');
  }

  /**
   * 전체 재동기화 (복구용)
   * 모든 행을 강제로 다시 동기화
   */
  async fullResync(): Promise<SyncResult> {
    return this.performSync(false, 'full');
  }
}
