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
import type { ChangeLogService, FieldChange } from './change-log-service.js';

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
    changeLogService?: ChangeLogService
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

    // 비교할 필드 매핑 (시트 컬럼명 → DB 필드명)
    const fieldMapping: Record<string, string> = {
      '받으실분': 'recipientName',
      '수취인 연락처': 'recipientPhone',
      '우편번호': 'postalCode',
      '주소': 'address',
      '배송메모': 'deliveryMemo',
      '5kg 수량': 'quantity5kg',
      '10kg 수량': 'quantity10kg',
      '가격': 'price',
    };

    for (const [sheetCol, dbField] of Object.entries(fieldMapping)) {
      const sheetValue = sheetRow[sheetCol];
      const dbValue = dbOrder[dbField];

      // 값이 다른 경우만 기록
      const normalizedSheet = sheetValue === undefined || sheetValue === '' ? null : sheetValue;
      const normalizedDb = dbValue === undefined || dbValue === '' ? null : dbValue;

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
  }> {
    const rowNumber = row._rowNumber;

    if (!rowNumber) {
      this.logger?.warn({ row }, 'Row has no _rowNumber, skipping');
      return { success: false, error: 'Missing _rowNumber' };
    }

    try {
      // 기존 주문 조회 (syncAttemptCount 확인용 + 충돌 감지)
      const existingOrder = await this.databaseService.getOrderByRowNumber(rowNumber);
      const attemptCount = existingOrder ? (existingOrder['_syncAttemptCount'] || 0) + 1 : 1;

      // 충돌 감지: DB가 'web'에서 수정되었고, 시트보다 최신인 경우
      if (existingOrder?.lastModifiedBy === 'web' && existingOrder.lastModifiedAt) {
        const sheetSyncAt = this.parseKstTimestamp(row['DB_SYNC_AT'] as string);

        if (sheetSyncAt && existingOrder.lastModifiedAt > sheetSyncAt) {
          // 충돌 발생 - 덮어쓰기 중단
          const conflictReason = `DB modified at ${existingOrder.lastModifiedAt.toISOString()} > Sheet sync at ${sheetSyncAt.toISOString()}`;

          this.logger?.warn(
            { rowNumber, orderId: existingOrder.id, conflictReason },
            'Conflict detected: DB was modified by web after last sync'
          );

          // 충돌 로그 기록 (ChangeLogService가 있는 경우)
          if (this.changeLogService) {
            const fieldChanges = this.calculateSheetDbDifferences(row, existingOrder as unknown as Record<string, unknown>);

            await this.changeLogService.logChange({
              orderId: existingOrder.id,
              sheetRowNumber: rowNumber,
              changedBy: 'sync',
              action: 'conflict_detected',
              fieldChanges,
              previousVersion: existingOrder.version ?? 1,
              conflictDetected: true,
              conflictResolution: 'db_wins', // 기본 정책: DB 우선
            });
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
      const order = await this.databaseService.upsertOrder(row, {
        syncStatus: 'success',
        syncAttemptCount: attemptCount,
      });

      this.logger?.debug({ rowNumber, orderId: order.id, attemptCount }, 'DB upsert successful');

      try {
        // Sheets 싱크 필드 업데이트
        await this.updateSheetSyncStatus(rowNumber, 'success', order.id);
        this.logger?.debug({ rowNumber }, 'Sheets sync status updated');

        return { success: true, orderId: order.id };
      } catch (sheetError) {
        // DB upsert 성공, Sheets 업데이트 실패
        const sheetMessage = sheetError instanceof Error ? sheetError.message : String(sheetError);
        this.logger?.error(
          { rowNumber, orderId: order.id, error: sheetMessage },
          'DB upsert succeeded but Sheets update failed'
        );

        return {
          success: false,
          orderId: order.id,
          error: `Sheets update failed: ${sheetMessage}`,
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
        const { success, error, conflict, conflictReason, orderId } = await this.syncRow(row);

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
