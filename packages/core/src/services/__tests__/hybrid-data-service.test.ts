/**
 * HybridDataService — hybrid 쓰기 정책 (#197)
 *
 * DB 우선: DB 가 실패하면 시트에 쓰지 않고 HybridWriteError.
 * DB 성공 · 시트 실패면 Order.syncStatus='failed' 기록 + partial 결과(warnings).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HybridDataService } from '../hybrid-data-service.js';
import { HybridWriteError, SHEET_SYNC_WARNING } from '../hybrid-write.js';
import type { SheetService } from '../sheet-service.js';
import type { DatabaseService } from '../database-service.js';

type Fn = ReturnType<typeof vi.fn>;

const WRITE_METHODS = [
  'markAsConfirmed',
  'markSingleAsConfirmed',
  'updateCell',
  'updateOrderStatus',
  'markPaymentConfirmed',
  'markDelivered',
  'softDelete',
  'restore',
  'updateOrder',
] as const;

type WriteMethod = (typeof WRITE_METHODS)[number];

/** 각 메서드를 부르는 방법과 시트 실패 기록에 넘어가야 할 행 번호 */
const CALLS: Record<WriteMethod, { call: (s: HybridDataService) => Promise<unknown>; rows: number[] | undefined }> = {
  markAsConfirmed: { call: (s) => s.markAsConfirmed([2, 3]), rows: [2, 3] },
  markSingleAsConfirmed: { call: (s) => s.markSingleAsConfirmed(4), rows: [4] },
  updateCell: { call: (s) => s.updateCell(5, '비고', '입금확인'), rows: [5] },
  updateOrderStatus: { call: (s) => s.updateOrderStatus(6, '입금확인'), rows: [6] },
  markPaymentConfirmed: { call: (s) => s.markPaymentConfirmed([7]), rows: [7] },
  markDelivered: { call: (s) => s.markDelivered([8], 'T-1'), rows: [8] },
  softDelete: { call: (s) => s.softDelete([9]), rows: [9] },
  restore: { call: (s) => s.restore([10]), rows: [10] },
  updateOrder: { call: (s) => s.updateOrder(11, { quantity: 2 }), rows: [11] },
};

function fakes() {
  const sheet = Object.fromEntries(WRITE_METHODS.map((m) => [m, vi.fn().mockResolvedValue(undefined)])) as Record<
    WriteMethod,
    Fn
  >;
  const db = {
    ...Object.fromEntries(WRITE_METHODS.map((m) => [m, vi.fn().mockResolvedValue(undefined)])),
    markSheetSyncFailed: vi.fn().mockResolvedValue(undefined),
    clearSheetSyncFailure: vi.fn().mockResolvedValue(undefined),
  } as Record<WriteMethod | 'markSheetSyncFailed' | 'clearSheetSyncFailure', Fn>;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { sheet, db, logger };
}

function hybrid(f: ReturnType<typeof fakes>) {
  return new HybridDataService(f.sheet as unknown as SheetService, f.db as unknown as DatabaseService, {
    mode: 'hybrid',
    logger: f.logger,
  });
}

describe('HybridDataService hybrid writes', () => {
  let f: ReturnType<typeof fakes>;

  beforeEach(() => {
    f = fakes();
  });

  describe.each(WRITE_METHODS)('%s', (method) => {
    const { call, rows } = CALLS[method];

    it('writes DB then Sheets and reports no warnings when both succeed', async () => {
      const outcome = await call(hybrid(f));
      expect(outcome).toEqual({ partial: false, warnings: [] });
      expect(f.db[method]).toHaveBeenCalledTimes(1);
      expect(f.sheet[method]).toHaveBeenCalledTimes(1);
      expect(f.db[method].mock.invocationCallOrder[0]).toBeLessThan(f.sheet[method].mock.invocationCallOrder[0]);
      expect(f.db.markSheetSyncFailed).not.toHaveBeenCalled();
      // 회귀: PR #230 Codex P2 (일부 필드만 쓴 성공으로 이전 시트 실패 표시를 지우지 않는다 — #231 재조정이 지운다)
      expect(f.db.clearSheetSyncFailure).not.toHaveBeenCalled();
    });

    it('does not touch Sheets when the DB write fails and throws HybridWriteError (503)', async () => {
      f.db[method].mockRejectedValue(new Error('db down'));
      const error = await call(hybrid(f)).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HybridWriteError);
      expect((error as HybridWriteError).statusCode).toBe(503);
      expect((error as HybridWriteError).failedStore).toBe('database');
      expect((error as HybridWriteError).publicMessage).toContain('변경된 내용은 없습니다');
      expect(f.db.clearSheetSyncFailure).not.toHaveBeenCalled();
      expect(f.sheet[method]).not.toHaveBeenCalled();
    });

    it('records the sheet failure and returns a partial outcome when only Sheets fails', async () => {
      f.sheet[method].mockRejectedValue(new Error('quota exceeded'));
      const outcome = await call(hybrid(f));
      expect(outcome).toEqual({ partial: true, warnings: [SHEET_SYNC_WARNING] });
      if (rows) {
        expect(f.db.markSheetSyncFailed).toHaveBeenCalledWith(rows, expect.stringContaining('quota exceeded'));
      }
      expect(f.logger.error).toHaveBeenCalledWith(expect.stringContaining('[hybrid-partial]'));
      expect(f.db.clearSheetSyncFailure).not.toHaveBeenCalled();
    });

    it('still returns the partial outcome when recording the sheet failure also fails', async () => {
      f.sheet[method].mockRejectedValue(new Error('quota exceeded'));
      f.db.markSheetSyncFailed.mockRejectedValue(new Error('db flaky'));
      const outcome = await call(hybrid(f));
      expect(outcome).toEqual({ partial: true, warnings: [SHEET_SYNC_WARNING] });
    });
  });

  it('does not record per-row failure for markAsConfirmed() without rows (all orders)', async () => {
    f.sheet.markAsConfirmed.mockRejectedValue(new Error('x'));
    const outcome = await hybrid(f).markAsConfirmed();
    expect(outcome.partial).toBe(true);
    expect(f.db.markSheetSyncFailed).not.toHaveBeenCalled();
  });
});

describe('HybridDataService single-store modes', () => {
  it.each(WRITE_METHODS)('sheets mode %s returns a non-partial outcome', async (method) => {
    const f = fakes();
    const service = new HybridDataService(f.sheet as unknown as SheetService, f.db as unknown as DatabaseService, {
      mode: 'sheets',
    });
    expect(await CALLS[method].call(service)).toEqual({ partial: false, warnings: [] });
    expect(f.db[method]).not.toHaveBeenCalled();
  });

  it.each(WRITE_METHODS)('database mode %s propagates DB errors unchanged', async (method) => {
    const f = fakes();
    f.db[method].mockRejectedValue(new Error('db down'));
    const service = new HybridDataService(null, f.db as unknown as DatabaseService, { mode: 'database' });
    await expect(CALLS[method].call(service)).rejects.toThrow('db down');
  });
});

describe('HybridDataService read fallback logging', () => {
  it('marks fallback warnings with [hybrid-fallback] so they can be found in production logs', async () => {
    const f = fakes();
    const sheet = { ...f.sheet, getAllRows: vi.fn().mockResolvedValue([]) };
    const db = { ...f.db, getAllRows: vi.fn().mockRejectedValue(new Error('auth failed')) };
    const service = new HybridDataService(sheet as unknown as SheetService, db as unknown as DatabaseService, {
      mode: 'hybrid',
      logger: f.logger,
    });
    await service.getAllRows();
    expect(f.logger.warn).toHaveBeenCalledWith(expect.stringContaining('[hybrid-fallback]'));
  });
});
