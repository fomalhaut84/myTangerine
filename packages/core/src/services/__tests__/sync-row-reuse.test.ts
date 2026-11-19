/**
 * 시트 행 번호 재사용 (#257)
 *
 * 시트에서 행을 지운 뒤 새 폼 주문이 그 행 번호를 받으면, 동기화가 같은 행 번호의 **다른** DB 주문을 덮어썼다.
 * - 같은 주문인지: 정규화한 원문 타임스탬프 먼저(시간대 무관) → 다르면 해석한 시각 · 둘 다 다를 때만 다른 주문
 * - 예전 주문이 시트 어디에도 없으면: 예전 주문을 행에서 분리 + 삭제 처리(보존 · 이력) → 새 주문 생성 (한 트랜잭션)
 * - 예전 주문이 시트 다른 행에 있거나 이 행의 주문이 DB 다른 행에 있으면(행이 밀림 · 폼 끼워 넣기): 쓰지 않고 실패
 * - 한 번의 동기화에서 교체가 3건을 넘으면 동기화 전체를 멈춘다(차단기)
 *
 * Prisma · SheetService 는 mock 이다(S-4).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { DatabaseService } from '../database-service.js';
import { SyncEngine } from '../sync-engine.js';
import { NEW_ORDER_NOTICE_WINDOW_MS, type NewOrderNoticePolicy } from '../new-order-notice.js';
import { parseKoreanTimestamp, type SheetRow } from '../../types/order.js';
import type { Config } from '../../config/config.js';
import type { SheetService } from '../sheet-service.js';

const NEW_TS = '2026. 11. 19. 오전 10:26:32';
const OLD_TS = '2026. 11. 17. 오후 2:50:00';
const NOW = parseKoreanTimestamp('2026. 11. 19. 오전 10:27:00');
const POLICY: NewOrderNoticePolicy = { windowMs: NEW_ORDER_NOTICE_WINDOW_MS, now: () => NOW };

function sheetRow(timestamp: string = NEW_TS): SheetRow {
  return {
    _rowNumber: 391,
    타임스탬프: timestamp,
    비고: '',
    보내는분: '보내는이',
    받으실분: '받는이',
    '상품 선택': '5kg',
    '5kg 수량': '1',
    '10kg 수량': '',
  } as unknown as SheetRow;
}

const OLD_ORDER = {
  id: 1487,
  sheetRowNumber: 391,
  timestamp: parseKoreanTimestamp(OLD_TS),
  timestampRaw: OLD_TS,
  status: '배송완료',
  version: 2,
  deletedAt: null,
  syncAttemptCount: 1,
  lastModifiedBy: 'web',
  lastModifiedAt: parseKoreanTimestamp(OLD_TS),
};

afterEach(() => {
  vi.useRealTimers();
});

function engine(opts: {
  existing: Record<string, unknown> | null;
  movedId?: number | null;
  notice?: NewOrderNoticePolicy;
  rows?: SheetRow[];
}) {
  const sheetService = { getAllRows: vi.fn().mockResolvedValue(opts.rows ?? [sheetRow()]) };
  const databaseService = {
    getRawOrderByRowNumber: vi.fn().mockImplementation(async (n: number) =>
      opts.existing ? { ...opts.existing, sheetRowNumber: n } : null
    ),
    findSyncedOrderIdByTimestamp: vi.fn().mockResolvedValue(opts.movedId ?? null),
    upsertOrder: vi.fn().mockResolvedValue({ id: 1487, newOrderNotice: null }),
    replaceOrderAtRow: vi.fn().mockResolvedValue({ id: 1500, newOrderNotice: opts.notice ? 'pending' : null }),
  };
  const e = new SyncEngine(
    sheetService as unknown as SheetService,
    databaseService as unknown as DatabaseService,
    undefined,
    undefined,
    opts.notice ? { newOrderNotice: opts.notice } : {}
  );
  const sheetStatus = vi
    .spyOn(e as unknown as { updateSheetSyncStatus: (...a: unknown[]) => Promise<void> }, 'updateSheetSyncStatus')
    .mockResolvedValue();
  return { e, databaseService, sheetStatus };
}

async function run(e: SyncEngine) {
  vi.useFakeTimers();
  const p = e.incrementalSync();
  await vi.runAllTimersAsync();
  return p;
}

describe('SyncEngine — 행 번호 재사용 판정', () => {
  it('같은 행 번호 · 다른 타임스탬프 · 다른 행에 없음 → 예전 주문 분리 후 새 주문 (덮어쓰지 않는다)', async () => {
    const { e, databaseService, sheetStatus } = engine({ existing: OLD_ORDER });
    const result = await run(e);

    expect(databaseService.upsertOrder).not.toHaveBeenCalled();
    expect(databaseService.findSyncedOrderIdByTimestamp).toHaveBeenCalledWith(parseKoreanTimestamp(NEW_TS), 391);
    expect(databaseService.upsertOrder).not.toHaveBeenCalled();
    const [existingArg, rowArg, metaArg, optArg] = databaseService.replaceOrderAtRow.mock.calls[0];
    expect(existingArg).toMatchObject({ id: 1487, version: 2 });
    expect(rowArg._rowNumber).toBe(391);
    expect(metaArg).toMatchObject({ syncStatus: 'success', syncAttemptCount: 1 });
    expect(optArg).toBeUndefined();
    // 시트에는 새 주문 id 로 성공 기록
    expect(sheetStatus).toHaveBeenCalledWith(391, 'success', 1500);
    expect(result).toMatchObject({ success: 1, failed: 0, replaced: 1 });
  });

  it('cron(알림 정책) 이면 새 주문에 정책을 넘기고 알림 건수에 넣는다', async () => {
    const { e, databaseService } = engine({ existing: OLD_ORDER, notice: POLICY });
    const result = await run(e);
    expect(databaseService.replaceOrderAtRow.mock.calls[0][3]).toEqual({ newOrderNotice: POLICY });
    expect(result.newOrderNotices).toBe(1);
  });

  it('그 타임스탬프의 주문이 DB 다른 행에 이미 있으면(행 밀림) → 쓰지 않고 실패', async () => {
    const { e, databaseService, sheetStatus } = engine({ existing: OLD_ORDER, movedId: 1490 });
    const result = await run(e);
    expect(databaseService.upsertOrder).not.toHaveBeenCalled();
    expect(databaseService.replaceOrderAtRow).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: 0, failed: 1, replaced: 0 });
    expect(result.errors[0].error).toContain("this row's order is DB #1490");
    // 기존 실패 경로와 같이 시트 DB_SYNC_STATUS 만 fail
    expect(sheetStatus).toHaveBeenCalledWith(391, 'fail');
  });

  it('예전 주문이 시트 다른 행에 아직 있으면(폼이 위에 끼워 넣어 밀림) → 쓰지 않고 실패 (운영 2026-11-19 사례)', async () => {
    const shiftedOld = { ...sheetRow(OLD_TS), _rowNumber: 393 } as SheetRow;
    const { e, databaseService, sheetStatus } = engine({ existing: OLD_ORDER, rows: [sheetRow(), shiftedOld] });
    const result = await run(e);
    expect(databaseService.replaceOrderAtRow).not.toHaveBeenCalled();
    expect(result.errors.find((x) => x.rowNumber === 391)?.error).toContain('that order is at another sheet row');
    expect(sheetStatus).toHaveBeenCalledWith(391, 'fail');
  });

  it('원문이 같으면 해석한 시각이 달라도(시간대 차이) 같은 주문 → 갱신', async () => {
    const tzShifted = { ...OLD_ORDER, timestamp: new Date(0), timestampRaw: '2026. 11. 19 오전 10:26:32' };
    const { e, databaseService } = engine({ existing: tzShifted });
    await run(e);
    expect(databaseService.upsertOrder).toHaveBeenCalledTimes(1);
    expect(databaseService.replaceOrderAtRow).not.toHaveBeenCalled();
  });

  it('한 번의 동기화에서 교체가 3건을 넘으면 동기화 전체를 멈춘다(차단기)', async () => {
    const rows = [391, 392, 393, 394].map(
      (n, i) => ({ ...sheetRow(`2026. 11. 19. 오전 10:2${i}:00`), _rowNumber: n }) as SheetRow
    );
    const { e, databaseService } = engine({ existing: OLD_ORDER, rows });
    vi.useFakeTimers();
    const p = e.incrementalSync();
    const assertion = expect(p).rejects.toThrow('Row replacement limit (3)');
    await vi.runAllTimersAsync();
    await assertion;
    expect(databaseService.replaceOrderAtRow).toHaveBeenCalledTimes(3);
  });

  it('타임스탬프가 같으면 지금처럼 갱신(upsert)', async () => {
    const { e, databaseService } = engine({
      existing: { ...OLD_ORDER, timestamp: parseKoreanTimestamp(NEW_TS), timestampRaw: NEW_TS },
    });
    await run(e);
    expect(databaseService.upsertOrder).toHaveBeenCalledTimes(1);
    expect(databaseService.replaceOrderAtRow).not.toHaveBeenCalled();
    expect(databaseService.findSyncedOrderIdByTimestamp).not.toHaveBeenCalled();
  });

  it('시트 타임스탬프를 읽을 수 없으면 판정하지 않고 지금처럼 갱신', async () => {
    const { e, databaseService } = engine({ existing: OLD_ORDER });
    (e as unknown as { sheetService: { getAllRows: ReturnType<typeof vi.fn> } }).sheetService.getAllRows.mockResolvedValue([
      sheetRow('잘못된 값'),
    ]);
    await run(e);
    expect(databaseService.upsertOrder).toHaveBeenCalledTimes(1);
    expect(databaseService.replaceOrderAtRow).not.toHaveBeenCalled();
  });

  it('DB 에 주문이 없으면 지금처럼 upsert(새로 만들기)', async () => {
    const { e, databaseService } = engine({ existing: null });
    await run(e);
    expect(databaseService.upsertOrder).toHaveBeenCalledTimes(1);
    expect(databaseService.replaceOrderAtRow).not.toHaveBeenCalled();
  });
});

function dbSetup() {
  const tx = {
    order: {
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({ id: 1500, newOrderNotice: 'pending' }),
    },
    orderChangeLog: { create: vi.fn().mockResolvedValue({ id: 92 }) },
  };
  const root = {
    order: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      create: vi.fn(),
    },
    orderChangeLog: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const service = new DatabaseService({} as Config, root as unknown as PrismaClient);
  return { tx, root, service };
}

describe('DatabaseService.replaceOrderAtRow — 한 트랜잭션', () => {
  it('예전 주문: 행 번호 비우기 + 삭제 처리 · 이력(delete) · 새 주문 create — 모두 tx 로', async () => {
    const { tx, root, service } = dbSetup();
    const created = await service.replaceOrderAtRow(
      { id: 1487, version: 2, deletedAt: null },
      sheetRow(),
      { syncStatus: 'success', syncAttemptCount: 1 },
      { newOrderNotice: POLICY }
    );

    expect(created).toEqual({ id: 1500, newOrderNotice: 'pending' });

    // 1) 예전 주문 분리 — 유일 제약을 먼저 비운다
    const detach = tx.order.update.mock.calls[0][0];
    expect(detach.where).toEqual({ id: 1487 });
    expect(detach.data.sheetRowNumber).toBeNull();
    expect(detach.data.deletedAt).toBeInstanceOf(Date);

    // 2) 이력 — 예전 행 번호로 · sync · delete · 사유
    const log = tx.orderChangeLog.create.mock.calls[0][0].data;
    expect(log).toMatchObject({ orderId: 1487, sheetRowNumber: 391, changedBy: 'sync', action: 'delete', previousVersion: 2 });
    expect(log.fieldChanges).toMatchObject({
      sheetRowNumber: { old: 391, new: null },
      reason: { old: null, new: 'sheet_row_reused' },
    });

    // 3) 새 주문 — 같은 행 번호 · 알림 대기 표시
    const create = tx.order.create.mock.calls[0][0].data;
    expect(create.sheetRowNumber).toBe(391);
    expect(create.newOrderNotice).toBe('pending');
    expect(create.syncStatus).toBe('success');

    // 루트 클라이언트로 새지 않는다
    expect(root.order.update).not.toHaveBeenCalled();
    expect(root.order.create).not.toHaveBeenCalled();
    expect(root.orderChangeLog.create).not.toHaveBeenCalled();
  });

  it('이미 삭제된 예전 주문은 삭제 시각을 바꾸지 않는다', async () => {
    const { tx, service } = dbSetup();
    const deletedAt = new Date('2026-11-18T00:00:00Z');
    await service.replaceOrderAtRow({ id: 1487, version: 2, deletedAt }, sheetRow(), { syncStatus: 'success' });
    expect(tx.order.update.mock.calls[0][0].data.deletedAt).toBe(deletedAt);
    expect(tx.orderChangeLog.create.mock.calls[0][0].data.fieldChanges).not.toHaveProperty('deletedAt');
  });

  it('정책이 없으면 새 주문에 알림 표시를 넣지 않는다', async () => {
    const { tx, service } = dbSetup();
    await service.replaceOrderAtRow({ id: 1487, version: 2, deletedAt: null }, sheetRow(), { syncStatus: 'success' });
    expect(tx.order.create.mock.calls[0][0].data).not.toHaveProperty('newOrderNotice');
  });

  it('새 주문 생성이 실패하면 원인을 담아 던진다(트랜잭션 롤백 — 예전 주문 분리도 되돌려진다)', async () => {
    const { tx, service } = dbSetup();
    tx.order.create.mockRejectedValue(new Error('unique violation'));
    await expect(
      service.replaceOrderAtRow({ id: 1487, version: 2, deletedAt: null }, sheetRow(), { syncStatus: 'success' })
    ).rejects.toThrow('Failed to replace order at reused row (row: 391, old #1487): unique violation');
  });
});

describe('DatabaseService.findSyncedOrderIdByTimestamp', () => {
  it('같은 시각 · 시트 행이 있고 · 이 행 번호가 아닌 주문', async () => {
    const { root, service } = dbSetup();
    root.order.findFirst.mockResolvedValue({ id: 1490 });
    const ts = parseKoreanTimestamp(NEW_TS);
    expect(await service.findSyncedOrderIdByTimestamp(ts, 391)).toBe(1490);
    expect(root.order.findFirst).toHaveBeenCalledWith({
      where: { timestamp: ts, sheetRowNumber: { not: 391 } },
      select: { id: true },
    });
  });

  it('없으면 null', async () => {
    const { service } = dbSetup();
    expect(await service.findSyncedOrderIdByTimestamp(new Date(), 391)).toBeNull();
  });
});
