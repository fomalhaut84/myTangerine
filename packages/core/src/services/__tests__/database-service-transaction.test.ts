/**
 * DatabaseService — 쓰기 + 변경 이력을 한 트랜잭션으로 (#197)
 *
 * 실제 롤백은 Prisma 가 한다. 여기서는 모든 쓰기·이력 쿼리가 트랜잭션 클라이언트(tx)로 가고
 * 루트 클라이언트로 새지 않는지, 이력 기록 실패가 쓰기 실패로 전파되는지를 본다.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  DatabaseService,
  SHEET_WRITE_PENDING_PREFIX,
  SHEET_WRITE_PENDING_GRACE_MS,
  SUPERSEDED_PENDING_REASON,
} from '../database-service.js';
import type { Config } from '../../config/config.js';

const ORDER = {
  id: 1,
  sheetRowNumber: 2,
  status: '신규주문',
  version: 3,
  trackingNumber: null,
  deletedAt: null,
};

function client() {
  return {
    order: {
      findMany: vi.fn().mockResolvedValue([ORDER]),
      findFirst: vi.fn().mockResolvedValue(ORDER),
      findUnique: vi.fn().mockResolvedValue(ORDER),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue(ORDER),
      create: vi.fn().mockResolvedValue({ ...ORDER, id: 99 }),
    },
    orderChangeLog: {
      create: vi.fn().mockResolvedValue({ id: 10 }),
    },
  };
}

function setup() {
  const tx = client();
  const root = {
    ...client(),
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const service = new DatabaseService({} as Config, root as unknown as PrismaClient);
  return { tx, root, service };
}

const WRITES: Array<[string, (s: DatabaseService) => Promise<unknown>]> = [
  ['markAsConfirmed', (s) => s.markAsConfirmed([2], 'web')],
  ['updateOrderStatus', (s) => s.updateOrderStatus(2, '입금확인', 'web')],
  ['markPaymentConfirmed', (s) => s.markPaymentConfirmed([2], 'web')],
  ['markDelivered', (s) => s.markDelivered([2], 'T-1', 'web')],
  ['markDeliveredById', (s) => s.markDeliveredById(1, 'T-1', 'web')],
  ['softDelete', (s) => s.softDelete([2], 'web')],
  ['restore', (s) => s.restore([2], 'web')],
  ['updateOrder', (s) => s.updateOrder(2, { productType: '5kg', quantity: 2, recipient: { name: '새이름' } }, 'web')],
];

describe('DatabaseService write transactions', () => {
  let ctx: ReturnType<typeof setup>;

  beforeEach(() => {
    ctx = setup();
  });

  it.each(WRITES)('%s runs every query inside one transaction', async (_name, write) => {
    // softDelete/restore 는 대상 상태가 달라야 이력이 남는다 — 상태와 무관하게 쿼리 경로만 본다
    await write(ctx.service);

    expect(ctx.root.$transaction).toHaveBeenCalledTimes(1);
    const rootCalls =
      ctx.root.order.create.mock.calls.length +
      ctx.root.order.findMany.mock.calls.length +
      ctx.root.order.findFirst.mock.calls.length +
      ctx.root.order.findUnique.mock.calls.length +
      ctx.root.order.updateMany.mock.calls.length +
      ctx.root.order.update.mock.calls.length +
      ctx.root.orderChangeLog.create.mock.calls.length;
    expect(rootCalls).toBe(0);
  });

  it('createClaimOrder returns the new id from inside the transaction', async () => {
    ctx.tx.order.findFirst.mockResolvedValue({ ...ORDER, status: '배송완료', quantity: 1, productType: '5kg' });
    const id = await ctx.service.createClaimOrder(2);
    expect(id).toBe(99);
    expect(ctx.tx.order.create).toHaveBeenCalledTimes(1);
    expect(ctx.root.order.create).not.toHaveBeenCalled();
  });

  it('writes the change log through the transaction client', async () => {
    await ctx.service.updateOrderStatus(2, '입금확인', 'web');
    expect(ctx.tx.orderChangeLog.create).toHaveBeenCalledTimes(1);
    expect(ctx.tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 }, data: expect.objectContaining({ lastModifiedBy: 'web' }) })
    );
  });

  it('fails the whole write when the change log insert fails (so Prisma rolls back)', async () => {
    ctx.tx.orderChangeLog.create.mockRejectedValue(new Error('log insert failed'));
    await expect(ctx.service.updateOrderStatus(2, '입금확인', 'web')).rejects.toThrow('log insert failed');
  });
});

describe('DatabaseService.markSheetSyncFailed', () => {
  it('marks the rows as failed with the reason, without touching version or change log', async () => {
    const { root, service } = setup();
    await service.markSheetSyncFailed([2, 3], 'Sheets: quota exceeded');
    expect(root.order.updateMany).toHaveBeenCalledWith({
      where: { sheetRowNumber: { in: [2, 3] } },
      data: { syncStatus: 'failed', syncErrorMessage: 'Sheets: quota exceeded' },
    });
    expect(root.orderChangeLog.create).not.toHaveBeenCalled();
  });

  it('truncates very long reasons', async () => {
    const { root, service } = setup();
    await service.markSheetSyncFailed([2], 'x'.repeat(5000));
    const data = root.order.updateMany.mock.calls[0][0].data;
    expect(data.syncErrorMessage.length).toBeLessThanOrEqual(1000);
  });

  it('does nothing for an empty row list', async () => {
    const { root, service } = setup();
    await service.markSheetSyncFailed([], 'x');
    expect(root.order.updateMany).not.toHaveBeenCalled();
  });
});

describe('DatabaseService — 시트 반영 대기 표시 (#293)', () => {
  it('markSheetSyncFailed 는 표시한 행 수를 돌려준다', async () => {
    const { root, service } = setup();
    root.order.updateMany.mockResolvedValue({ count: 2 });
    expect(await service.markSheetSyncFailed([2, 3], 'x')).toBe(2);
  });

  // 회귀: PR #303 Codex P2 (끝나지 않은 이전 쓰기의 대기 표시를 다음 쓰기가 덮고 지워, 이전 쓰기의 칸이 시트에 반영되지 않은 채 success 가 됐다)
  it('markSheetWritePending: 다른 쓰기의 대기 표시는 재조정 필요 사유로 바꾼다 — 어느 쓰기도 고유값으로 지우지 못한다', async () => {
    const { root, service } = setup();
    await service.markSheetWritePending([2, 3], 'tok-1');
    expect(root.order.updateMany).toHaveBeenNthCalledWith(1, {
      where: { sheetRowNumber: { in: [2, 3] }, syncStatus: 'failed', syncErrorMessage: { startsWith: SHEET_WRITE_PENDING_PREFIX } },
      data: { syncErrorMessage: SUPERSEDED_PENDING_REASON },
    });
    // 대기 접두어(재조정 5분 여유) · 고유값(UUID)과는 같을 수 없다(어느 쓰기도 지우지 못한다)
    expect(SUPERSEDED_PENDING_REASON).toBe(`${SHEET_WRITE_PENDING_PREFIX}superseded`);
  });

  it('markSheetWritePending: 실패 표시가 없는 행에만 이번 고유값으로 표시한다', async () => {
    const { root, service } = setup();
    await service.markSheetWritePending([2, 3], 'tok-1');
    expect(root.order.updateMany).toHaveBeenNthCalledWith(2, {
      where: { sheetRowNumber: { in: [2, 3] }, syncStatus: { not: 'failed' } },
      data: { syncStatus: 'failed', syncErrorMessage: `${SHEET_WRITE_PENDING_PREFIX}tok-1` },
    });
    expect(root.orderChangeLog.create).not.toHaveBeenCalled();
  });

  it('markSheetWritePending: 실패 표시(사유)가 있는 행은 사유를 지키고 updatedAt 만 갱신한다(먼저 읽은 재조정기가 지우지 못하게)', async () => {
    const { root, service } = setup();
    await service.markSheetWritePending([2], 'tok-1');
    const third = root.order.updateMany.mock.calls[2][0];
    expect(third.where).toEqual({
      sheetRowNumber: { in: [2] },
      syncStatus: 'failed',
      OR: [{ syncErrorMessage: null }, { NOT: { syncErrorMessage: { startsWith: SHEET_WRITE_PENDING_PREFIX } } }],
    });
    expect(Object.keys(third.data)).toEqual(['updatedAt']);
  });

  it('clearSheetWritePending: 그 고유값이 그대로인 행만 성공으로 되돌린다(그 사이 실패 사유로 바뀐 행은 남긴다)', async () => {
    const { root, service } = setup();
    root.order.updateMany.mockResolvedValue({ count: 1 });
    expect(await service.clearSheetWritePending([2, 3], 'tok-1')).toBe(1);
    expect(root.order.updateMany).toHaveBeenCalledWith({
      where: { sheetRowNumber: { in: [2, 3] }, syncStatus: 'failed', syncErrorMessage: `${SHEET_WRITE_PENDING_PREFIX}tok-1` },
      data: { syncStatus: 'success', syncErrorMessage: null },
    });
  });

  it.each(['markSheetWritePending', 'clearSheetWritePending'] as const)('%s: 빈 행 목록이면 아무것도 하지 않는다', async (m) => {
    const { root, service } = setup();
    await service[m]([], 'tok');
    expect(root.order.updateMany).not.toHaveBeenCalled();
  });

  it('markSheetSyncFailedById: 그 주문 하나에 실패 사유를 남긴다', async () => {
    const { root, service } = setup();
    root.order.updateMany.mockResolvedValue({ count: 1 });
    expect(await service.markSheetSyncFailedById(7, 'reconcile stale')).toBe(1);
    expect(root.order.updateMany).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { syncStatus: 'failed', syncErrorMessage: 'reconcile stale' },
    });
  });

  it('getSheetSyncFailedOrders: 진행 중인(최근) 대기 표시는 재조정 대상에서 뺀다 — 오래된 표시(중간 종료)는 넣는다', async () => {
    const { root, service } = setup();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-20T10:00:00Z'));
    try {
      await service.getSheetSyncFailedOrders(10);
    } finally {
      vi.useRealTimers();
    }
    const where = root.order.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ syncStatus: 'failed', sheetRowNumber: { not: null } });
    expect(where.OR).toEqual([
      { syncErrorMessage: null },
      { NOT: { syncErrorMessage: { startsWith: SHEET_WRITE_PENDING_PREFIX } } },
      { updatedAt: { lte: new Date(Date.parse('2026-11-20T10:00:00Z') - SHEET_WRITE_PENDING_GRACE_MS) } },
    ]);
  });
});
