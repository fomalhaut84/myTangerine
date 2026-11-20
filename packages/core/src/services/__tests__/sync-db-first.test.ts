/**
 * hybrid DB 우선 동기화 (#281)
 *
 * 정본은 DB 다. 시트 → DB 는 새 주문이 처음 들어올 때만 쓴다.
 * - 증분(cron · 수동): DB 에 있는 같은 주문은 시트 값이 달라도 DB 를 바꾸지 않는다 — 상태 칸만 쓴다
 * - 전체(시트 우선 가져오기 · 운영자 복구): 시트 값으로 덮어쓰되 바뀐 필드를 변경 이력에 남기고,
 *   DB 에만 있는 변경(시트 반영 실패 · syncStatus=failed)은 덮어쓰지 않고 재조정 대기로 알린다
 * - #228: 웹-시트 "충돌" 개념은 없다 — 충돌 로그를 만들지 않는다
 * - 새 주문을 만들 때 최초 입력값(original_input)을 저장한다
 *
 * SheetService · Prisma 는 mock 이다(S-4).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { SyncEngine, SHEET_FIRST_RECENT_EDIT_MARGIN_MS } from '../sync-engine.js';
import { DatabaseService } from '../database-service.js';
import { parseKoreanTimestamp, type SheetRow } from '../../types/order.js';
import type { SheetService } from '../sheet-service.js';
import type { Config } from '../../config/config.js';

const TS = '2026. 11. 19. 오전 10:26:32';

function sheetRow(overrides: Record<string, string> = {}): SheetRow {
  return {
    _rowNumber: 10,
    타임스탬프: TS,
    비고: '',
    '보내는분 성함': '시트 보내는이',
    '받으실분 성함': '시트 받는이',
    '받으실분 주소 (도로명 주소로 부탁드려요)': '시트 주소',
    '받으실분 연락처 (핸드폰번호)': '010-0000-0000',
    '상품 선택': '5kg',
    '5kg 수량': '1',
    '10kg 수량': '',
    ...overrides,
  } as unknown as SheetRow;
}

const EXISTING = {
  id: 5,
  sheetRowNumber: 10,
  timestamp: parseKoreanTimestamp(TS),
  timestampRaw: TS,
  recipientName: '웹에서 고친 받는이',
  version: 3,
  deletedAt: null,
  syncStatus: 'success',
  syncAttemptCount: 1,
  lastModifiedBy: 'web',
  lastModifiedAt: new Date('2026-11-19T00:00:00Z'),
};

afterEach(() => {
  vi.useRealTimers();
});

function engine(existing: Record<string, unknown> | null, row: SheetRow = sheetRow()) {
  const writes: Array<{ row: number; updates: Record<string, string> }> = [];
  const sheetService = {
    getAllRowsSnapshot: vi.fn().mockResolvedValue({
      rows: [row],
      physical: [{ _rowNumber: row._rowNumber as number, 타임스탬프: row['타임스탬프'] as string }],
    }),
    getTimestampsByRows: vi.fn().mockImplementation(async (nums: number[]) => new Map(nums.map((n) => [n, TS]))),
    updateRowsCells: vi.fn().mockImplementation(async (batch: typeof writes) => {
      writes.push(...batch);
    }),
  };
  const databaseService = {
    getRawOrderByRowNumber: vi.fn().mockResolvedValue(existing),
    findOrderAtOtherRow: vi.fn().mockResolvedValue(null),
    upsertOrder: vi.fn().mockImplementation(async () => ({ id: existing?.id ?? 99, newOrderNotice: null })),
    overwriteOrderFromSheet: vi.fn().mockImplementation(async () => ({ order: { id: existing?.id ?? 99 }, fieldChanges: {} })),
    // 시트 행 → DB 필드 변환은 prisma 없이 도는 실제 함수를 쓴다
    sheetRowToPrismaOrderData: (r: SheetRow) => DatabaseService.prototype.sheetRowToPrismaOrderData.call(null, r),
  };
  const e = new SyncEngine(sheetService as unknown as SheetService, databaseService as unknown as DatabaseService);
  return { e, databaseService, writes };
}

async function run(e: SyncEngine, mode: 'incremental' | 'full') {
  vi.useFakeTimers();
  const p = mode === 'full' ? e.fullResync() : e.incrementalSync();
  await vi.runAllTimersAsync();
  return p;
}

describe('SyncEngine — 증분 동기화는 새 주문만 만든다 (#281)', () => {
  it('DB 에 있는 같은 주문은 DB 를 바꾸지 않고 상태 칸만 쓴다 — 새 주문 성공이 아니라 "유지" 로 센다', async () => {
    const { e, databaseService, writes } = engine(EXISTING);
    const result = await run(e, 'incremental');

    expect(databaseService.upsertOrder).not.toHaveBeenCalled();
    expect(databaseService.overwriteOrderFromSheet).not.toHaveBeenCalled();
    expect(writes.map((w) => [w.row, w.updates.DB_SYNC_STATUS, w.updates.DB_SYNC_ID])).toEqual([[10, 'success', '5']]);
    expect(result).toMatchObject({ success: 0, unchanged: 1, failed: 0, pendingReconcileRows: [] });
  });

  it('시트 값이 DB 와 다르면 DB 를 유지하고 그 행을 보고한다(값은 로그에 남기지 않음)', async () => {
    const { e } = engine(EXISTING);
    const result = await run(e, 'incremental');
    expect(result.sheetDivergedRows).toEqual([10]);
  });

  it('상태 칸 DB_SYNC_AT 은 지금이 아니라 DB 가 마지막으로 반영된 시각이다', async () => {
    const syncedAt = new Date('2026-11-18T01:02:03Z');
    const { e, writes } = engine({ ...EXISTING, syncedAt });
    await run(e, 'incremental');
    expect(writes[0].updates.DB_SYNC_AT).toBe('2026-11-18T10:02:03+09:00');
  });

  it('시트 반영 실패 표시(syncStatus=failed) 주문은 DB 도 시트 상태 칸도 건드리지 않는다 (#231 재조정 대상)', async () => {
    const { e, databaseService, writes } = engine({ ...EXISTING, syncStatus: 'failed' });
    const result = await run(e, 'incremental');
    expect(databaseService.upsertOrder).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(result.unchanged).toBe(1);
  });

  it('DB 에 없는 행은 지금처럼 만든다', async () => {
    const { e, databaseService } = engine(null);
    const result = await run(e, 'incremental');
    expect(databaseService.upsertOrder).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: 1, unchanged: 0 });
  });
});

describe('SyncEngine — 전체 동기화 = 시트 우선 가져오기(운영자 복구) (#281)', () => {
  it('기존 주문은 overwriteOrderFromSheet(트랜잭션 · version 확인 · 이력)로 덮어쓴다', async () => {
    const { e, databaseService } = engine({ ...EXISTING, lastModifiedBy: 'sync' });
    const result = await run(e, 'full');

    expect(databaseService.upsertOrder).not.toHaveBeenCalled();
    expect(databaseService.overwriteOrderFromSheet).toHaveBeenCalledTimes(1);
    const [existingArg, rowArg] = databaseService.overwriteOrderFromSheet.mock.calls[0];
    expect(existingArg).toMatchObject({ id: 5, version: 3 });
    expect(rowArg._rowNumber).toBe(10);
    expect(result.success).toBe(1);
  });

  it('덮어쓰기가 실패하면(동시 수정 등) 그 행은 실패 · DB 그대로', async () => {
    const { e, databaseService } = engine({ ...EXISTING, lastModifiedBy: 'sync' });
    databaseService.overwriteOrderFromSheet.mockRejectedValue(new Error('changed concurrently'));
    const result = await run(e, 'full');
    expect(result).toMatchObject({ success: 0, failed: 1 });
    expect(result.errors[0].error).toContain('changed concurrently');
  });

  it('DB 에만 있는 변경(syncStatus=failed)은 덮어쓰지 않고 재조정 대기 행으로 알린다 — 상태 칸도 쓰지 않는다', async () => {
    const { e, databaseService, writes } = engine({ ...EXISTING, syncStatus: 'failed' });
    const result = await run(e, 'full');
    expect(databaseService.overwriteOrderFromSheet).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(result).toMatchObject({ success: 0, failed: 0, pendingReconcileRows: [10] });
  });

  it('#228: 웹 수정이 시트 동기화 시각보다 새로워도 충돌이 아니다 — 시트 값으로 덮어쓰고 이력을 남긴다', async () => {
    const { e, databaseService } = engine(EXISTING, sheetRow({ DB_SYNC_AT: '2026-11-18T00:00:00+09:00' }));
    const result = await run(e, 'full');
    expect(databaseService.overwriteOrderFromSheet).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: 1, pendingReconcileRows: [] });
    expect(result).not.toHaveProperty('conflicts');
    expect(result).not.toHaveProperty('conflictDetails');
  });

  it('#228: 가져오기가 시트를 읽은 뒤 웹에서 고친 주문은 낡은 스냅샷으로 덮지 않고 실패로 알린다 — 시트 상태 칸도 쓰지 않는다', async () => {
    const afterSnapshot = new Date(Date.now() + 60 * 60 * 1000);
    const { e, databaseService, writes } = engine({ ...EXISTING, lastModifiedAt: afterSnapshot });
    const result = await run(e, 'full');
    expect(databaseService.overwriteOrderFromSheet).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(result).toMatchObject({ success: 0, failed: 1, pendingReconcileRows: [] });
    expect(result.errors[0].error).toContain('the sheet snapshot was read');
  });

  it('#228: 스냅샷 직전(여유 안)에 고친 주문도 덮지 않는다 — 웹의 시트 쓰기가 스냅샷보다 늦었을 수 있다', async () => {
    const justBefore = new Date(Date.now() - SHEET_FIRST_RECENT_EDIT_MARGIN_MS / 2);
    const { e, databaseService } = engine({ ...EXISTING, lastModifiedAt: justBefore });
    const result = await run(e, 'full');
    expect(databaseService.overwriteOrderFromSheet).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
  });

  it('#228: 여유보다 오래전에 고친 주문은 덮어쓴다', async () => {
    const longAgo = new Date(Date.now() - SHEET_FIRST_RECENT_EDIT_MARGIN_MS * 2);
    const { e, databaseService } = engine({ ...EXISTING, lastModifiedAt: longAgo });
    const result = await run(e, 'full');
    expect(databaseService.overwriteOrderFromSheet).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(1);
  });

  it('#228: 스냅샷 뒤 시각이라도 동기화 자신(sync)이 남긴 수정이면 덮어쓴다', async () => {
    const afterSnapshot = new Date(Date.now() + 60 * 60 * 1000);
    const { e, databaseService } = engine({ ...EXISTING, lastModifiedBy: 'sync', lastModifiedAt: afterSnapshot });
    const result = await run(e, 'full');
    expect(databaseService.overwriteOrderFromSheet).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(1);
  });

  it('#228: 시트 DB_SYNC_AT 이 비었거나 깨진 웹 수정 주문도 같은 규칙으로 덮어쓴다', async () => {
    const { e, databaseService } = engine(EXISTING, sheetRow({ DB_SYNC_AT: 'not-a-date' }));
    const result = await run(e, 'full');
    expect(databaseService.overwriteOrderFromSheet).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(1);
  });
});

describe('DatabaseService — 새 주문에 최초 입력값 저장 (#281)', () => {
  function dbWith() {
    const prisma = {
      order: { upsert: vi.fn().mockResolvedValue({ id: 1 }) },
    };
    const service = new DatabaseService({} as Config, prisma as unknown as PrismaClient);
    return { prisma, service };
  }

  it('create 에만 original_input 을 넣고 update(시트 우선 가져오기)에는 넣지 않는다', async () => {
    const { prisma, service } = dbWith();
    await service.upsertOrder(sheetRow({ '추가 요청사항': '문 앞', 비고: '입금확인', DB_SYNC_STATUS: 'fail' }));
    const arg = prisma.order.upsert.mock.calls[0][0];
    expect(arg.create.originalInput).toMatchObject({ 타임스탬프: TS, '받으실분 성함': '시트 받는이', '추가 요청사항': '문 앞' });
    expect(arg.create.originalInput).not.toHaveProperty('비고');
    expect(arg.create.originalInput).not.toHaveProperty('DB_SYNC_STATUS');
    expect(arg.update).not.toHaveProperty('originalInput');
  });

  function txDb(current: Record<string, unknown> | null) {
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue(current),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 5 }),
      },
      orderChangeLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
    const service = new DatabaseService({} as Config, prisma as unknown as PrismaClient);
    const logChange = vi.spyOn(service.changeLogService, 'logChange').mockResolvedValue(undefined as never);
    return { tx, service, logChange };
  }

  it('overwriteOrderFromSheet: 한 트랜잭션에서 덮어쓰고 바뀐 필드 전체(상태 · 송장 포함)를 이력에 남긴다', async () => {
    const current = { ...EXISTING, status: '배송완료', trackingNumber: '777', senderName: '시트 보내는이', recipientAddress: '시트 주소', recipientPhone: '010-0000-0000', quantity5kg: '1', quantity10kg: '', productSelection: '5kg', productType: '5kg', quantity: 1, orderType: 'customer', ordererName: null, ordererEmail: null, validationError: null };
    const { tx, service, logChange } = txDb(current);
    const { fieldChanges } = await service.overwriteOrderFromSheet({ id: 5, version: 3 }, sheetRow(), { syncStatus: 'success', syncAttemptCount: 2 });

    expect(tx.order.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.order.updateMany.mock.calls[0][0].where).toEqual({ id: 5, version: 3 });
    expect(tx.order.updateMany.mock.calls[0][0].data).not.toHaveProperty('originalInput');
    expect(fieldChanges).toMatchObject({
      status: { old: '배송완료', new: '신규주문' },
      trackingNumber: { old: '777', new: null },
      recipientName: { old: '웹에서 고친 받는이', new: '시트 받는이' },
    });
    expect(logChange).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 5, changedBy: 'sync', action: 'update', previousVersion: 3, fieldChanges }),
      tx
    );
  });

  it('overwriteOrderFromSheet: 읽은 뒤 웹 수정으로 version 이 바뀌었으면 쓰지 않고 던진다', async () => {
    const { tx, service } = txDb({ ...EXISTING, version: 4 });
    await expect(
      service.overwriteOrderFromSheet({ id: 5, version: 3 }, sheetRow(), { syncStatus: 'success' })
    ).rejects.toThrow('changed concurrently');
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });

  it('overwriteOrderFromSheet: 확인 뒤 쓰기 직전에 커밋된 웹 수정이 있으면(조건 갱신 0건) 이력 없이 던진다', async () => {
    const current = { ...EXISTING };
    const { tx, service, logChange } = txDb(current);
    tx.order.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.overwriteOrderFromSheet({ id: 5, version: 3 }, sheetRow(), { syncStatus: 'success' })
    ).rejects.toThrow('changed concurrently while overwriting');
    expect(logChange).not.toHaveBeenCalled();
  });

  it('overwriteOrderFromSheet: 주문이 사라졌으면 쓰지 않고 던진다', async () => {
    const { service, logChange } = txDb(null);
    // 주문이 사라졌으면 던진다
    await expect(service.overwriteOrderFromSheet({ id: 5, version: 3 }, sheetRow(), { syncStatus: 'success' })).rejects.toThrow();
    expect(logChange).not.toHaveBeenCalled();
  });
});
