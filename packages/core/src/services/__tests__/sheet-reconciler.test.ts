/**
 * hybrid 시트 반영 실패 자동 재조정 (#231 · DB 우선 #281)
 *
 * DB 가 정본이므로 시트 반영에 실패한 주문은 DB 현재 값을 시트 행에 다시 쓴다.
 * - 쓰기 전: 시트 행의 타임스탬프가 그 주문인지 확인(엄격 — 빈 칸 · 다른 주문이면 쓰지 않는다)
 * - 쓴 뒤: 다시 읽어 확인(밀렸으면 실패 표시를 남기고 보고)
 * - 실패 표시는 읽은 뒤 주문이 바뀌지 않았을 때(updatedAt 같음)만 지운다 — 웹 수정이 끼면 다음 회차가 최신 값으로
 * - 쓰는 칸: 앱 칸 · 웹에서 고칠 수 있는 칸 · DB_SYNC_*. 타임스탬프 · 주문자 칸(고객 원본)은 쓰지 않는다
 *
 * SheetService · DatabaseService 는 mock 이다(S-4).
 */

import { describe, it, expect, vi } from 'vitest';
import { SheetReconciler, RECONCILE_BATCH_LIMIT, buildReconcileCells } from '../sheet-reconciler.js';
import type { SheetService } from '../sheet-service.js';
import type { DatabaseService } from '../database-service.js';
import { parseKoreanTimestamp } from '../../types/order.js';

const ts = (row: number) => `2026. 11. 19. 오전 10:${String(row % 60).padStart(2, '0')}:00`;

function order(row: number, overrides: Record<string, unknown> = {}) {
  return {
    id: 1000 + row,
    sheetRowNumber: row,
    timestamp: parseKoreanTimestamp(ts(row)),
    timestampRaw: ts(row),
    status: '배송완료',
    trackingNumber: '777',
    deletedAt: null,
    orderType: 'customer',
    senderName: '보내는이',
    senderPhone: '010-1',
    senderAddress: '보내는 주소',
    recipientName: '받는이',
    recipientPhone: '010-2',
    recipientAddress: '받는 주소',
    productSelection: '5kg',
    quantity5kg: '2',
    quantity10kg: '',
    ordererName: '주문자',
    ordererEmail: 'a@example.com',
    syncStatus: 'failed',
    updatedAt: new Date('2026-11-19T01:00:00Z'),
    ...overrides,
  };
}

function setup(orders: ReturnType<typeof order>[], opts: { before?: (r: number) => string; after?: (r: number) => string; writeError?: Error; cleared?: (id: number) => number } = {}) {
  let reads = 0;
  const writes: Array<{ row: number; updates: Record<string, string> }> = [];
  const sheet = {
    getTimestampsByRows: vi.fn().mockImplementation(async (rows: number[]) => {
      reads++;
      const pick = reads === 1 ? opts.before : opts.after;
      return new Map(rows.map((r) => [r, pick ? pick(r) : ts(r)]));
    }),
    updateRowsCells: vi.fn().mockImplementation(async (batch: typeof writes) => {
      if (opts.writeError) throw opts.writeError;
      writes.push(...batch);
    }),
  };
  const db = {
    getSheetSyncFailedOrders: vi.fn().mockResolvedValue(orders),
    clearSheetSyncFailureIfUnchanged: vi.fn().mockImplementation(async (id: number) => (opts.cleared ? opts.cleared(id) : 1)),
  };
  const reconciler = new SheetReconciler(sheet as unknown as SheetService, db as unknown as DatabaseService);
  return { reconciler, sheet, db, writes };
}

describe('buildReconcileCells', () => {
  it('DB 현재 값 → 시트 칸. 고객 원본 칸(타임스탬프 · 주문자)은 쓰지 않는다', () => {
    const cells = buildReconcileCells(order(10, { deletedAt: new Date('2026-11-19T02:00:00Z'), orderType: 'gift' }) as never);
    expect(cells).toEqual({
      비고: '배송완료',
      송장번호: '777',
      삭제됨: '2026-11-19T02:00:00.000Z',
      주문유형: '선물',
      '보내는분 성함': '보내는이',
      '보내는분 연락처 (핸드폰번호)': '010-1',
      '보내는분 주소 (도로명 주소로 부탁드려요)': '보내는 주소',
      '받으실분 성함': '받는이',
      '받으실분 연락처 (핸드폰번호)': '010-2',
      '받으실분 주소 (도로명 주소로 부탁드려요)': '받는 주소',
      '상품 선택': '5kg',
      '5kg 수량': '2',
      '10kg 수량': '',
      DB_SYNC_STATUS: 'success',
      DB_SYNC_AT: '2026-11-19T10:00:00+09:00',
      DB_SYNC_ID: '1010',
    });
  });

  it('삭제 안 됨 · 송장 없음 → 빈 칸, 판매 주문 → 판매, 배송사고 → 배송사고', () => {
    expect(buildReconcileCells(order(1, { trackingNumber: null }) as never)).toMatchObject({ 송장번호: '', 삭제됨: '', 주문유형: '판매' });
    expect(buildReconcileCells(order(1, { orderType: 'claim' }) as never).주문유형).toBe('배송사고');
  });
});

describe('SheetReconciler.reconcile', () => {
  it('대상이 없으면 시트를 읽지도 쓰지도 않는다', async () => {
    const { reconciler, sheet } = setup([]);
    const result = await reconciler.reconcile();
    expect(sheet.getTimestampsByRows).not.toHaveBeenCalled();
    expect(result).toMatchObject({ attempted: 0, reconciled: [] });
  });

  it(`최대 ${RECONCILE_BATCH_LIMIT}건을 읽어 한 번에 쓰고, 쓴 뒤 확인 후 실패 표시를 지운다`, async () => {
    const { reconciler, sheet, db, writes } = setup([order(10), order(11)]);
    const result = await reconciler.reconcile();

    expect(db.getSheetSyncFailedOrders).toHaveBeenCalledWith(RECONCILE_BATCH_LIMIT);
    expect(sheet.updateRowsCells).toHaveBeenCalledTimes(1);
    expect(writes.map((w) => w.row)).toEqual([10, 11]);
    expect(sheet.getTimestampsByRows).toHaveBeenCalledTimes(2); // 전 · 후
    expect(db.clearSheetSyncFailureIfUnchanged).toHaveBeenCalledWith(1010, order(10).updatedAt);
    expect(result).toMatchObject({ attempted: 2, reconciled: [10, 11], skippedIdentity: [], shiftedAfterWrite: [], stale: [] });
  });

  it('시트 행이 다른 주문(또는 빈 칸)이면 그 행은 쓰지 않고 표시를 남긴다 — 나머지는 진행', async () => {
    const { reconciler, db, writes } = setup([order(10), order(11)], { before: (r) => (r === 11 ? ts(99) : ts(r)) });
    const result = await reconciler.reconcile();
    expect(writes.map((w) => w.row)).toEqual([10]);
    expect(result.skippedIdentity).toEqual([11]);
    expect(db.clearSheetSyncFailureIfUnchanged).toHaveBeenCalledTimes(1);
  });

  it('쓴 직후 행이 바뀌었으면 표시를 지우지 않고 보고한다', async () => {
    const { reconciler, db } = setup([order(10)], { after: () => ts(42) });
    const result = await reconciler.reconcile();
    expect(result.shiftedAfterWrite).toEqual([10]);
    expect(result.reconciled).toEqual([]);
    expect(db.clearSheetSyncFailureIfUnchanged).not.toHaveBeenCalled();
  });

  it('읽은 뒤 웹 수정이 있었으면(조건 해제 0건) stale — 다음 회차가 최신 값으로 다시 맞춘다', async () => {
    const { reconciler } = setup([order(10)], { cleared: () => 0 });
    const result = await reconciler.reconcile();
    expect(result).toMatchObject({ reconciled: [], stale: [10] });
  });

  it('쓰기가 실패하면 표시를 남기고 실패로 보고한다(던지지 않는다)', async () => {
    const { reconciler, db } = setup([order(10)], { writeError: new Error('503') });
    const result = await reconciler.reconcile();
    expect(result.failed).toEqual([{ rowNumber: 10, error: expect.stringContaining('503') }]);
    expect(db.clearSheetSyncFailureIfUnchanged).not.toHaveBeenCalled();
  });

  it('쓰기 전 확인 읽기가 실패해도 던지지 않고 실패로 보고한다', async () => {
    const { reconciler, sheet } = setup([order(10)]);
    sheet.getTimestampsByRows.mockRejectedValueOnce(new Error('quota'));
    const result = await reconciler.reconcile();
    expect(result.failed[0].error).toContain('quota');
    expect(sheet.updateRowsCells).not.toHaveBeenCalled();
  });

  it('쓴 뒤 확인 읽기가 실패하면 표시를 지우지 않는다(다음 회차가 다시 확인하고 쓴다)', async () => {
    const { reconciler, sheet, db } = setup([order(10)]);
    sheet.getTimestampsByRows.mockImplementationOnce(async (rows: number[]) => new Map(rows.map((r) => [r, ts(r)]))).mockRejectedValueOnce(new Error('quota'));
    const result = await reconciler.reconcile();
    expect(db.clearSheetSyncFailureIfUnchanged).not.toHaveBeenCalled();
    expect(result.failed[0].error).toContain('quota');
  });
});

describe('DatabaseService 재조정 쿼리', () => {
  it('대상: 실패 표시 · 시트 행 있음 · 오래된 것부터 · 상한', async () => {
    const { DatabaseService } = await import('../database-service.js');
    const findMany = vi.fn().mockResolvedValue([]);
    const svc = new DatabaseService({} as never, { order: { findMany } } as never);
    await svc.getSheetSyncFailedOrders(10);
    expect(findMany).toHaveBeenCalledWith({
      where: { syncStatus: 'failed', sheetRowNumber: { not: null } },
      orderBy: { updatedAt: 'asc' },
      take: 10,
    });
  });

  it('해제: 읽은 updatedAt 과 같고 아직 실패 표시인 주문만 · 지운 건수를 돌려준다', async () => {
    const { DatabaseService } = await import('../database-service.js');
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const svc = new DatabaseService({} as never, { order: { updateMany } } as never);
    const read = new Date('2026-11-19T01:00:00Z');
    expect(await svc.clearSheetSyncFailureIfUnchanged(5, read)).toBe(0);
    expect(updateMany.mock.calls[0][0].where).toEqual({ id: 5, syncStatus: 'failed', updatedAt: read });
    expect(updateMany.mock.calls[0][0].data).toMatchObject({ syncStatus: 'success', syncErrorMessage: null });
  });
});
