/**
 * SyncEngine
 * Google Sheets → PostgreSQL 동기화 엔진
 *
 * Issue #68 Phase 2.1
 */

import type { SheetService, DatabaseService, SheetRow } from '@mytangerine/core';
import { logger } from '../utils/logger.js';

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
  constructor(
    private sheetService: SheetService,
    private databaseService: DatabaseService
  ) {}

  /**
   * Sheets의 싱크 상태 필드 업데이트
   * @param rowNumber - 행 번호
   * @param status - 'success' | 'fail'
   * @param orderId - DB의 order ID (선택)
   */
  private async updateSheetSyncStatus(
    rowNumber: number,
    status: 'success' | 'fail',
    orderId?: number
  ): Promise<void> {
    try {
      // DB_SYNC_STATUS 업데이트
      await this.sheetService.updateCell(rowNumber, 'DB_SYNC_STATUS', status);

      // DB_SYNC_AT 업데이트 (ISO 8601 형식)
      const syncTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
      await this.sheetService.updateCell(rowNumber, 'DB_SYNC_AT', syncTime);

      // DB_SYNC_ID 업데이트 (성공 시만)
      if (orderId !== undefined) {
        await this.sheetService.updateCell(rowNumber, 'DB_SYNC_ID', String(orderId));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(
        { rowNumber, error: message },
        'Failed to update sheet sync status (non-critical)'
      );
      // Sheets 업데이트 실패는 비치명적 - DB 싱크는 성공했으므로 계속 진행
    }
  }

  /**
   * 단일 행 동기화
   * @param row - SheetRow 데이터
   * @returns 성공 여부 및 order ID
   */
  private async syncRow(row: SheetRow): Promise<{ success: boolean; orderId?: number }> {
    const rowNumber = row._rowNumber;

    if (!rowNumber) {
      logger.warn({ row }, 'Row has no _rowNumber, skipping');
      return { success: false };
    }

    try {
      // DB에 upsert
      const order = await this.databaseService.upsertOrder(row, {
        syncStatus: 'success',
        syncAttemptCount: 1,
      });

      logger.debug({ rowNumber, orderId: order.id }, 'Row synced successfully');

      // Sheets 싱크 필드 업데이트
      await this.updateSheetSyncStatus(rowNumber, 'success', order.id);

      return { success: true, orderId: order.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ rowNumber, error: message }, 'Failed to sync row');

      // DB upsert 실패 시 Sheets에 fail 상태 기록
      await this.updateSheetSyncStatus(rowNumber, 'fail');

      return { success: false };
    }
  }

  /**
   * 증분 동기화 (기본 모드)
   * DB_SYNC_STATUS가 비어있는 행만 동기화
   */
  async incrementalSync(): Promise<SyncResult> {
    logger.info('Starting incremental sync...');

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

      logger.info({ total: result.total }, 'Fetched rows from Google Sheets');

      // 각 행 동기화
      for (const row of allRows) {
        const rowNumber = row._rowNumber;

        if (!rowNumber) {
          result.skipped++;
          continue;
        }

        // DB_SYNC_STATUS 확인 (증분 모드: 이미 싱크된 행은 스킵)
        const syncStatus = row['DB_SYNC_STATUS'] || '';
        if (syncStatus === 'success') {
          logger.debug({ rowNumber }, 'Row already synced, skipping');
          result.skipped++;
          continue;
        }

        // 행 동기화
        const { success } = await this.syncRow(row);

        if (success) {
          result.success++;
        } else {
          result.failed++;
          result.errors.push({
            rowNumber,
            error: 'Sync failed (see logs)',
          });
        }
      }

      logger.info(
        { success: result.success, failed: result.failed, skipped: result.skipped },
        'Incremental sync completed'
      );

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, 'Incremental sync failed');
      throw new Error(`Incremental sync failed: ${message}`);
    }
  }

  /**
   * 전체 재동기화 (복구용)
   * 모든 행을 강제로 다시 동기화
   */
  async fullResync(): Promise<SyncResult> {
    logger.info('Starting full resync...');

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

      logger.info({ total: result.total }, 'Fetched rows from Google Sheets');

      // 각 행 동기화 (DB_SYNC_STATUS 무시하고 모두 재동기화)
      for (const row of allRows) {
        const rowNumber = row._rowNumber;

        if (!rowNumber) {
          result.skipped++;
          continue;
        }

        const { success } = await this.syncRow(row);

        if (success) {
          result.success++;
        } else {
          result.failed++;
          result.errors.push({
            rowNumber,
            error: 'Sync failed (see logs)',
          });
        }
      }

      logger.info(
        { success: result.success, failed: result.failed, skipped: result.skipped },
        'Full resync completed'
      );

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, 'Full resync failed');
      throw new Error(`Full resync failed: ${message}`);
    }
  }
}
