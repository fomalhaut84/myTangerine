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
  errors: Array<{ rowNumber: number; error: string }>;
}

/**
 * 싱크 엔진 클래스
 */
export class SyncEngine {
  private logger?: Logger;

  constructor(
    private sheetService: SheetService,
    private databaseService: DatabaseService,
    logger?: Logger
  ) {
    this.logger = logger;
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
    // KST (UTC+9) 시간으로 변환
    const now = new Date();
    const kstTime = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const syncTime = kstTime.toISOString().replace('T', ' ').substring(0, 19);

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
   * @returns 성공 여부, order ID, 에러 메시지
   */
  private async syncRow(row: SheetRow): Promise<{
    success: boolean;
    orderId?: number;
    error?: string;
  }> {
    const rowNumber = row._rowNumber;

    if (!rowNumber) {
      this.logger?.warn({ row }, 'Row has no _rowNumber, skipping');
      return { success: false, error: 'Missing _rowNumber' };
    }

    try {
      // 기존 주문 조회 (syncAttemptCount 확인용)
      const existingOrder = await this.databaseService.getOrderByRowNumber(rowNumber);
      const attemptCount = existingOrder ? (existingOrder['_syncAttemptCount'] || 0) + 1 : 1;

      // DB에 upsert
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
   * 증분 동기화 (기본 모드)
   * DB_SYNC_STATUS가 'success'인 행은 스킵
   */
  async incrementalSync(): Promise<SyncResult> {
    this.logger?.info('Starting incremental sync...');

    const result: SyncResult = {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      errors: [],
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

        // DB_SYNC_STATUS 확인 (증분 모드: 싱크 상태가 'success'인 행은 스킵)
        const syncStatus = row['DB_SYNC_STATUS'];
        if (syncStatus === 'success') {
          this.logger?.debug({ rowNumber, syncStatus }, 'Row already synced successfully, skipping');
          result.skipped++;
          continue;
        }

        // 행 동기화
        const { success, error } = await this.syncRow(row);

        if (success) {
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
        { success: result.success, failed: result.failed, skipped: result.skipped },
        'Incremental sync completed'
      );

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger?.error({ error: message }, 'Incremental sync failed');
      throw new Error(`Incremental sync failed: ${message}`);
    }
  }

  /**
   * 전체 재동기화 (복구용)
   * 모든 행을 강제로 다시 동기화
   */
  async fullResync(): Promise<SyncResult> {
    this.logger?.info('Starting full resync...');

    const result: SyncResult = {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    };

    try {
      // 모든 행 가져오기
      const allRows = await this.sheetService.getAllRows();
      result.total = allRows.length;

      this.logger?.info({ total: result.total }, 'Fetched rows from Google Sheets');

      // 각 행 동기화 (DB_SYNC_STATUS 무시하고 모두 재동기화)
      for (const row of allRows) {
        const rowNumber = row._rowNumber;

        if (!rowNumber) {
          result.skipped++;
          continue;
        }

        const { success, error } = await this.syncRow(row);

        if (success) {
          result.success++;
        } else {
          result.failed++;
          result.errors.push({
            rowNumber,
            error: error || 'Unknown error',
          });
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      this.logger?.info(
        { success: result.success, failed: result.failed, skipped: result.skipped },
        'Full resync completed'
      );

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger?.error({ error: message }, 'Full resync failed');
      throw new Error(`Full resync failed: ${message}`);
    }
  }
}
