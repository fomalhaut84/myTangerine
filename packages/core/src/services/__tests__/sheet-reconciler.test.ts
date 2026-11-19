/**
 * hybrid 시트 반영 실패 자동 재조정 (#231 · DB 우선 #281)
 *
 * DB 가 정본이므로 시트 반영에 실패한 주문은 DB 현재 값을 시트 행에 다시 맞춘다.
 * - 헤더 + 행을 한 번에 새로 읽어(헤더 캐시가 낡아 엉뚱한 열에 쓰지 않게) 행 정체성을 확인하고(엄격)
 * - DB 값과 **다른 칸만** 쓴다 — 확인과 쓰기 사이에 행이 밀려도 덮이는 칸을 최소로
 * - 쓴 뒤 다시 확인 · 실패 표시는 읽은 뒤 주문이 바뀌지 않았을 때(updatedAt 같음)만 지운다
 * - 건너뛰거나 실패한 주문은 미룬다(백오프) — 막힌 주문이 뒤 주문을 가리지 않게
 * - 던지지 않는다
 *
 * SheetService · DatabaseService 는 mock 이다(S-4).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  SheetReconciler,
  RECONCILE_BATCH_LIMIT,
  RECONCILE_CANDIDATE_FACTOR,
  RECONCILE_BACKOFF_BASE_MS,
  buildReconcileCells,
} from '../sheet-reconciler.js';
import type { SheetService } from '../sheet-service.js';
import type { DatabaseService } from '../database-service.js';
import { parseKoreanTimestamp } from '../../types/order.js';

const ts = (row: number) => `2026. 11. 19. 오전 10:${String(row % 60).padStart(2, '0')}:00`;
const UPDATED = new Date('2026-11-19T01:00:00Z');

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
    productType: '5kg',
    quantity5kg: '2',
    quantity10kg: '',
    syncStatus: 'failed',
    updatedAt: UPDATED,
    ...overrides,
  };
}

const HEADERS = [
  '타임스탬프', '비고', '송장번호', '삭제됨', '주문유형',
  '보내는분 성함', '보내는분 연락처 (핸드폰번호)', '보내는분 주소 (도로명 주소로 부탁드려요)',
  '받으실분 성함', '받으실분 연락처 (핸드폰번호)', '받으실분 주소 (도로명 주소로 부탁드려요)',
  '상품 선택', '5kg 수량', '10kg 수량', 'DB_SYNC_STATUS', 'DB_SYNC_AT', 'DB_SYNC_ID',
];

/** 시트 행 값 — 기본은 DB 와 같고 상태(비고) · 송장 · DB_SYNC 만 뒤처진 상태 */
function sheetRowOf(o: ReturnType<typeof order>, overrides: Record<string, string> = {}): Record<string, string> {
  return {
    ...Object.fromEntries(HEADERS.map((h) => [h, ''])),
    ...buildReconcileCells(o as never),
    타임스탬프: o.timestampRaw,
    비고: '입금확인',
    송장번호: '',
    DB_SYNC_STATUS: 'success',
    DB_SYNC_AT: '',
    ...overrides,
  };
}

function setup(
  orders: ReturnType<typeof order>[],
  opts: {
    sheet?: (o: ReturnType<typeof order>) => Record<string, string> | undefined;
    headers?: string[];
    after?: (row: number) => string;
    writeError?: Error;
    cleared?: (id: number) => number | Error;
    now?: () => number;
  } = {}
) {
  const writes: Array<{ row: number; updates: Record<string, string> }> = [];
  const sheet = {
    getRowsWithHeaders: vi.fn().mockImplementation(async (rows: number[]) => ({
      headers: opts.headers ?? HEADERS,
      rows: new Map(
        rows.flatMap((r) => {
          const o = orders.find((x) => x.sheetRowNumber === r)!;
          const v = opts.sheet ? opts.sheet(o) : sheetRowOf(o);
          return v ? [[r, v] as const] : [];
        })
      ),
    })),
    getTimestampsByRows: vi.fn().mockImplementation(async (rows: number[]) => new Map(rows.map((r) => [r, opts.after ? opts.after(r) : ts(r)]))),
    updateRowsCells: vi.fn().mockImplementation(async (batch: typeof writes) => {
      if (opts.writeError) throw opts.writeError;
      writes.push(...batch);
    }),
  };
  const db = {
    getSheetSyncFailedOrders: vi.fn().mockResolvedValue(orders),
    clearSheetSyncFailureIfUnchanged: vi.fn().mockImplementation(async (id: number) => {
      const r = opts.cleared ? opts.cleared(id) : 1;
      if (r instanceof Error) throw r;
      return r;
    }),
  };
  const reconciler = new SheetReconciler(sheet as unknown as SheetService, db as unknown as DatabaseService, undefined, {
    now: opts.now ?? (() => 0),
  });
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

  it('웹에서 상품을 바꾼 주문(productType ≠ 원문 해석)은 시트 쓰기 경로처럼 productType 을 쓴다 · 반대 수량 0 은 빈 칸', () => {
    const cells = buildReconcileCells(order(1, { productSelection: '5kg', productType: '10kg', quantity5kg: '0', quantity10kg: '3' }) as never);
    expect(cells).toMatchObject({ '상품 선택': '10kg', '5kg 수량': '', '10kg 수량': '3' });
  });

  it('삭제 안 됨 · 송장 없음 → 빈 칸, 판매 → 판매, 배송사고 → 배송사고', () => {
    expect(buildReconcileCells(order(1, { trackingNumber: null }) as never)).toMatchObject({ 송장번호: '', 삭제됨: '', 주문유형: '판매' });
    expect(buildReconcileCells(order(1, { orderType: 'claim' }) as never).주문유형).toBe('배송사고');
  });
});

describe('SheetReconciler.reconcile', () => {
  it('대상이 없으면 시트를 읽지도 쓰지도 않는다', async () => {
    const { reconciler, sheet } = setup([]);
    const result = await reconciler.reconcile();
    expect(sheet.getRowsWithHeaders).not.toHaveBeenCalled();
    expect(result).toMatchObject({ attempted: 0, reconciled: [] });
  });

  it('후보를 넉넉히 읽고 상한만큼 처리 · DB 와 다른 칸만 쓰고 · 쓴 뒤 확인 후 표시를 지운다', async () => {
    const { reconciler, sheet, db, writes } = setup([order(10), order(11)]);
    const result = await reconciler.reconcile();

    expect(db.getSheetSyncFailedOrders).toHaveBeenCalledWith(RECONCILE_BATCH_LIMIT * RECONCILE_CANDIDATE_FACTOR, []);
    expect(sheet.getRowsWithHeaders).toHaveBeenCalledWith([10, 11]);
    expect(sheet.updateRowsCells).toHaveBeenCalledTimes(1);
    // 같은 칸(보내는분 · 받으실분 · 상품 · 수량 · 주문유형 등)은 쓰지 않는다
    expect(writes).toEqual([
      { row: 10, updates: { 비고: '배송완료', 송장번호: '777', DB_SYNC_AT: '2026-11-19T10:00:00+09:00' } },
      { row: 11, updates: { 비고: '배송완료', 송장번호: '777', DB_SYNC_AT: '2026-11-19T10:00:00+09:00' } },
    ]);
    expect(sheet.getTimestampsByRows).toHaveBeenCalledWith([10, 11]);
    expect(db.clearSheetSyncFailureIfUnchanged).toHaveBeenCalledWith(1010, UPDATED);
    expect(result).toMatchObject({ attempted: 2, reconciled: [10, 11], skippedIdentity: [], shiftedAfterWrite: [], stale: [] });
  });

  it('시트가 이미 DB 와 같으면 쓰지 않고 표시만 지운다', async () => {
    const same = (o: ReturnType<typeof order>) => sheetRowOf(o, { 비고: '배송완료', 송장번호: '777', DB_SYNC_AT: '2026-11-19T10:00:00+09:00' });
    const { reconciler, sheet, db } = setup([order(10)], { sheet: same });
    const result = await reconciler.reconcile();
    expect(sheet.updateRowsCells).not.toHaveBeenCalled();
    expect(sheet.getTimestampsByRows).not.toHaveBeenCalled();
    expect(db.clearSheetSyncFailureIfUnchanged).toHaveBeenCalledTimes(1);
    expect(result.reconciled).toEqual([10]);
  });

  it('헤더에 없는 칸은 쓰지 않고 보고한다(다른 칸은 맞춘다)', async () => {
    const headers = HEADERS.filter((h) => h !== '주문유형');
    const { reconciler, writes } = setup([order(10, { orderType: 'gift' })], { headers });
    const result = await reconciler.reconcile();
    expect(writes[0].updates).not.toHaveProperty('주문유형');
    expect(result.missingColumns).toEqual(['주문유형']);
    expect(result.reconciled).toEqual([10]);
  });

  it('시트 행이 다른 주문(또는 빈 칸 · 없음)이면 그 행은 쓰지 않는다 — 나머지는 진행', async () => {
    const o10 = order(10);
    const o11 = order(11);
    const { reconciler, db, writes } = setup([o10, o11], {
      sheet: (o) => (o === o11 ? sheetRowOf(o, { 타임스탬프: ts(99) }) : sheetRowOf(o)),
    });
    const result = await reconciler.reconcile();
    expect(writes.map((w) => w.row)).toEqual([10]);
    expect(result.skippedIdentity).toEqual([11]);
    expect(db.clearSheetSyncFailureIfUnchanged).toHaveBeenCalledTimes(1);
  });

  it('쓴 직후 행이 바뀌었으면 표시를 지우지 않고, 써진 칸 수와 함께 보고한다', async () => {
    const { reconciler, db } = setup([order(10)], { after: () => ts(42) });
    const result = await reconciler.reconcile();
    expect(result.shiftedAfterWrite).toEqual([{ rowNumber: 10, cells: 3 }]);
    expect(result.reconciled).toEqual([]);
    expect(db.clearSheetSyncFailureIfUnchanged).not.toHaveBeenCalled();
  });

  it('읽은 뒤 웹 수정이 있었으면(조건 해제 0건) stale — 다음 회차가 최신 값으로', async () => {
    const { reconciler } = setup([order(10)], { cleared: () => 0 });
    const result = await reconciler.reconcile();
    expect(result).toMatchObject({ reconciled: [], stale: [10] });
  });

  it('표시 해제 DB 오류는 그 주문만 실패로 — 다른 주문 결과는 남는다(던지지 않는다)', async () => {
    const { reconciler } = setup([order(10), order(11)], { cleared: (id) => (id === 1010 ? new Error('db down') : 1) });
    const result = await reconciler.reconcile();
    expect(result.failed).toEqual([{ rowNumber: 10, error: expect.stringContaining('db down') }]);
    expect(result.reconciled).toEqual([11]);
  });

  it('쓰기가 실패하면 표시를 남기고 실패로 보고한다', async () => {
    const { reconciler, db } = setup([order(10)], { writeError: new Error('503') });
    const result = await reconciler.reconcile();
    expect(result.failed).toEqual([{ rowNumber: 10, error: expect.stringContaining('503') }]);
    expect(db.clearSheetSyncFailureIfUnchanged).not.toHaveBeenCalled();
  });

  it('행 읽기가 실패해도 던지지 않는다', async () => {
    const { reconciler, sheet } = setup([order(10)]);
    sheet.getRowsWithHeaders.mockRejectedValueOnce(new Error('quota'));
    const result = await reconciler.reconcile();
    expect(result.failed[0].error).toContain('quota');
    expect(sheet.updateRowsCells).not.toHaveBeenCalled();
  });

  it('대상 조회(DB) 오류도 던지지 않고 실패로 보고한다', async () => {
    const { reconciler, db } = setup([order(10)]);
    db.getSheetSyncFailedOrders.mockRejectedValueOnce(new Error('db down'));
    const result = await reconciler.reconcile();
    expect(result.failed).toEqual([{ rowNumber: 0, error: expect.stringContaining('db down') }]);
  });

  it('건너뛴 · 실패한 주문은 미뤄 두고(백오프) 그 사이 뒤 주문을 처리한다', async () => {
    let now = 0;
    const blocked = Array.from({ length: RECONCILE_BATCH_LIMIT }, (_, i) => order(10 + i));
    const waiting = order(50);
    const { reconciler, sheet, db } = setup([...blocked, waiting], {
      sheet: (o) => (o === waiting ? sheetRowOf(o) : sheetRowOf(o, { 타임스탬프: ts(99) })),
      now: () => now,
    });
    const first = await reconciler.reconcile();
    expect(first.skippedIdentity).toHaveLength(RECONCILE_BATCH_LIMIT);
    expect(first.deferred).toBe(1);

    now += 1000; // 백오프 안 — 미룬 주문은 조회에서 뺀다(막힌 주문이 아무리 많아도 뒤 주문이 처리된다)
    const second = await reconciler.reconcile();
    expect(db.getSheetSyncFailedOrders.mock.lastCall?.[1]).toHaveLength(RECONCILE_BATCH_LIMIT);
    expect(sheet.getRowsWithHeaders).toHaveBeenLastCalledWith([50]);
    expect(second.reconciled).toEqual([50]);

    now += RECONCILE_BACKOFF_BASE_MS; // 백오프가 지나면 다시 시도
    await reconciler.reconcile();
    expect(sheet.getRowsWithHeaders.mock.lastCall?.[0]).toHaveLength(RECONCILE_BATCH_LIMIT);
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
    await svc.getSheetSyncFailedOrders(10, [3, 4]);
    expect(findMany.mock.lastCall?.[0].where).toMatchObject({ id: { notIn: [3, 4] } });
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
