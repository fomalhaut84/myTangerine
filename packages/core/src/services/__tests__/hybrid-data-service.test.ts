/**
 * HybridDataService — hybrid 쓰기 정책 (#197)
 *
 * DB 우선: DB 가 실패하면 시트에 쓰지 않고 HybridWriteError.
 * DB 성공 · 시트 실패면 Order.syncStatus='failed' 기록 + partial 결과(warnings).
 * #293: DB 를 쓰기 전에 "시트 반영 대기" 표시를 먼저 남기고(이번 쓰기 고유값) 시트까지 성공하면 그 표시만 지운다 —
 * 표시 기록 실패 · 중간 종료에도 DB 전용 변경이 표시 없이 남지 않게(시트 우선 가져오기 보호).
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
  updateOrderStatus: { call: (s) => s.updateOrderStatus(6, '입금확인'), rows: [6] },
  markPaymentConfirmed: { call: (s) => s.markPaymentConfirmed([7]), rows: [7] },
  markDelivered: { call: (s) => s.markDelivered([8], 'T-1'), rows: [8] },
  softDelete: { call: (s) => s.softDelete([9]), rows: [9] },
  restore: { call: (s) => s.restore([10]), rows: [10] },
  updateOrder: { call: (s) => s.updateOrder(11, { quantity: 2 }), rows: [11] },
};

function fakes() {
  // #258: 쓰기 전 행 확인 — 기본은 "시트 행이 DB 주문과 같다"
  const raw = (n: number) => `2026. 11. ${n}. 오전 10:00:00`;
  const sheet = {
    ...Object.fromEntries(WRITE_METHODS.map((m) => [m, vi.fn().mockResolvedValue(undefined)])),
    getTimestampsByRows: vi.fn(async (rows: number[]) => new Map(rows.map((n) => [n, raw(n)]))),
  } as Record<WriteMethod | 'getTimestampsByRows', Fn>;
  const db = {
    ...Object.fromEntries(WRITE_METHODS.map((m) => [m, vi.fn().mockResolvedValue(undefined)])),
    markSheetSyncFailed: vi.fn().mockResolvedValue(1),
    clearSheetSyncFailureIfUnchanged: vi.fn().mockResolvedValue(undefined),
    markSheetWritePending: vi.fn().mockResolvedValue(undefined),
    clearSheetWritePending: vi.fn().mockResolvedValue(1),
    getOrderTimestampsByRows: vi.fn(
      async (rows: number[]) => new Map(rows.map((n) => [n, { timestamp: new Date(0), timestampRaw: raw(n) }]))
    ),
  } as Record<
    | WriteMethod
    | 'markSheetSyncFailed'
    | 'clearSheetSyncFailureIfUnchanged'
    | 'markSheetWritePending'
    | 'clearSheetWritePending'
    | 'getOrderTimestampsByRows',
    Fn
  >;
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
      expect(f.db.clearSheetSyncFailureIfUnchanged).not.toHaveBeenCalled();
    });

    it('does not touch Sheets when the DB write fails and throws HybridWriteError (503)', async () => {
      f.db[method].mockRejectedValue(new Error('db down'));
      const error = await call(hybrid(f)).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HybridWriteError);
      expect((error as HybridWriteError).statusCode).toBe(503);
      expect((error as HybridWriteError).failedStore).toBe('database');
      expect((error as HybridWriteError).publicMessage).toContain('변경된 내용은 없습니다');
      expect(f.db.clearSheetSyncFailureIfUnchanged).not.toHaveBeenCalled();
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
      expect(f.db.clearSheetSyncFailureIfUnchanged).not.toHaveBeenCalled();
    });

    it('still returns the partial outcome when recording the sheet failure also fails', async () => {
      f.sheet[method].mockRejectedValue(new Error('quota exceeded'));
      f.db.markSheetSyncFailed.mockRejectedValue(new Error('db flaky'));
      const outcome = await call(hybrid(f));
      expect(outcome).toEqual({ partial: true, warnings: [SHEET_SYNC_WARNING] });
      // #293: 먼저 남긴 대기 표시는 지우지 않는다 — 그 표시가 DB 전용 변경을 지킨다
      expect(f.db.clearSheetWritePending).not.toHaveBeenCalled();
    });

    if (rows) {
      it('#293: DB 를 쓰기 전에 대기 표시를 남기고, 시트까지 성공하면 같은 고유값으로 그 표시만 지운다', async () => {
        await call(hybrid(f));
        expect(f.db.markSheetWritePending).toHaveBeenCalledWith(rows, expect.any(String));
        const token = f.db.markSheetWritePending.mock.calls[0][1];
        expect(f.db.clearSheetWritePending).toHaveBeenCalledWith(rows, token);
        const order = (fn: Fn) => fn.mock.invocationCallOrder[0];
        expect(order(f.db.markSheetWritePending)).toBeLessThan(order(f.db[method]));
        expect(order(f.sheet[method])).toBeLessThan(order(f.db.clearSheetWritePending));
      });

      it('#293: 대기 표시를 남기지 못하면 DB · 시트 모두 쓰지 않고 503', async () => {
        f.db.markSheetWritePending.mockRejectedValue(new Error('db flaky'));
        const error = await call(hybrid(f)).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(HybridWriteError);
        expect(f.db[method]).not.toHaveBeenCalled();
        expect(f.sheet[method]).not.toHaveBeenCalled();
      });

      it('#293: DB 쓰기가 실패하면 대기 표시를 거둔다(아무것도 바뀌지 않았다)', async () => {
        f.db[method].mockRejectedValue(new Error('db down'));
        await call(hybrid(f)).catch(() => undefined);
        const token = f.db.markSheetWritePending.mock.calls[0][1];
        expect(f.db.clearSheetWritePending).toHaveBeenCalledWith(rows, token);
      });

      it('#293: 시트가 실패하면 실패 사유로 표시하고 대기 표시는 지우지 않는다', async () => {
        f.sheet[method].mockRejectedValue(new Error('quota exceeded'));
        await call(hybrid(f));
        expect(f.db.markSheetSyncFailed).toHaveBeenCalled();
        expect(f.db.clearSheetWritePending).not.toHaveBeenCalled();
      });

      it('#293: 성공 뒤 대기 표시를 지우지 못해도 성공으로 답하고 로그를 남긴다(표시가 남으면 재조정이 맞춘다)', async () => {
        f.db.clearSheetWritePending.mockRejectedValue(new Error('db flaky'));
        const outcome = await call(hybrid(f));
        expect(outcome).toEqual({ partial: false, warnings: [] });
        expect(f.logger.error).toHaveBeenCalledWith(expect.stringContaining('pending'));
      });
    }
  });

  it('#293: 시트 실패 표시가 대상보다 적은 행에 남으면 로그로 알린다', async () => {
    f.sheet.markDelivered.mockRejectedValue(new Error('quota exceeded'));
    f.db.markSheetSyncFailed.mockResolvedValue(1);
    await hybrid(f).markDelivered([8, 9], 'T-1');
    expect(f.logger.error).toHaveBeenCalledWith(expect.stringContaining('marked 1 of 2'));
  });

  it('#293: updateCell 은 없다(이력 · version 을 남기지 않는 쓰기 — 호출처 0)', () => {
    expect((hybrid(f) as unknown as Record<string, unknown>).updateCell).toBeUndefined();
  });

  // 회귀(#234): 행 번호 없는 일괄 확인은 DB 에서 "배송완료가 아닌 주문 전부"(입금확인 포함)를 바꿨다 — 시트와 함께 아무것도 하지 않는다
  it.each([
    ['without rows', undefined],
    ['with an empty row list', [] as number[]],
  ])('markAsConfirmed %s writes nothing to DB or Sheets', async (_label, rows) => {
    const outcome = await hybrid(f).markAsConfirmed(rows);
    expect(outcome).toEqual({ partial: false, warnings: [] });
    expect(f.db.markAsConfirmed).not.toHaveBeenCalled();
    expect(f.sheet.markAsConfirmed).not.toHaveBeenCalled();
  });
});

describe('HybridDataService.markAsConfirmed without rows by mode (#234)', () => {
  it.each([undefined, [] as number[]])('database mode writes nothing for %s', async (rows) => {
    const f = fakes();
    const service = new HybridDataService(null, f.db as unknown as DatabaseService, { mode: 'database' });
    expect(await service.markAsConfirmed(rows)).toEqual({ partial: false, warnings: [] });
    expect(f.db.markAsConfirmed).not.toHaveBeenCalled();
  });

  it('sheets mode keeps the legacy SheetService behaviour (passes the input through)', async () => {
    const f = fakes();
    const service = new HybridDataService(f.sheet as unknown as SheetService, f.db as unknown as DatabaseService, {
      mode: 'sheets',
    });
    await service.markAsConfirmed();
    expect(f.sheet.markAsConfirmed).toHaveBeenCalledWith(undefined);
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
