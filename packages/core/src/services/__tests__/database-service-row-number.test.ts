/**
 * DatabaseService — 시트 행 번호가 없는 주문과 일괄 처리 범위 (#234)
 *
 * - 배송사고(claim) 주문은 sheetRowNumber 가 null 이다. order_change_logs.sheet_row_number 는 NOT NULL 이라
 *   null 로 이력을 쓰면 트랜잭션 전체가 실패한다 → 기존 관례(markDeliveredById)대로 이력을 건너뛴다
 * - markAsConfirmed 는 행 번호를 명시해야만 처리한다. 예전에는 빈 배열·인자 없음이
 *   "배송완료가 아닌 주문 전부"(입금확인 포함)를 배송완료로 바꿨다 — 시트 쪽은 같은 입력에서 아무것도 하지 않는다
 *
 * Prisma 는 mock 이다(S-4).
 */

import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { DatabaseService } from '../database-service.js';
import type { Config } from '../../config/config.js';

function setup(order: Record<string, unknown>) {
  const tx = {
    order: {
      findMany: vi.fn().mockResolvedValue([order]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue(order),
    },
    orderChangeLog: { create: vi.fn().mockResolvedValue({ id: 10 }) },
  };
  const root = { $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
  const service = new DatabaseService({} as Config, root as unknown as PrismaClient);
  return { tx, root, service };
}

const SHEETLESS = { id: 7, sheetRowNumber: null, version: 1, trackingNumber: null };

describe('DatabaseService.markAsConfirmed scope (#234)', () => {
  it.each([
    ['an empty row list', [] as number[]],
    ['no row list', undefined],
  ])('does nothing for %s (never touches every unfinished order)', async (_label, rows) => {
    const { root, tx, service } = setup({ ...SHEETLESS, status: '입금확인', deletedAt: null });
    await service.markAsConfirmed(rows, 'web');
    expect(root.$transaction).not.toHaveBeenCalled();
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });

  it('only targets the given rows', async () => {
    const { tx, service } = setup({ id: 1, sheetRowNumber: 2, status: '신규주문', version: 1, deletedAt: null });
    await service.markAsConfirmed([2], 'web');
    expect(tx.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sheetRowNumber: { in: [2] }, deletedAt: null } })
    );
  });
});

describe('DatabaseService change log for orders without a sheet row (#234)', () => {
  const CASES: Array<[string, Record<string, unknown>, (s: DatabaseService) => Promise<unknown>]> = [
    ['markAsConfirmed', { status: '입금확인', deletedAt: null }, (s) => s.markAsConfirmed([2], 'web')],
    ['markPaymentConfirmed', { status: '신규주문', deletedAt: null }, (s) => s.markPaymentConfirmed([2], 'web')],
    ['markDelivered', { status: '입금확인', deletedAt: null }, (s) => s.markDelivered([2], 'T-1', 'web')],
    ['softDelete', { status: '입금확인', deletedAt: null }, (s) => s.softDelete([2], 'web')],
    ['restore', { status: '입금확인', deletedAt: new Date() }, (s) => s.restore([2], 'web')],
  ];

  it.each(CASES)('%s still writes but skips the change log (sheet_row_number is NOT NULL)', async (_n, state, write) => {
    const { tx, service } = setup({ ...SHEETLESS, ...state });
    await write(service);
    expect(tx.order.updateMany).toHaveBeenCalled();
    expect(tx.orderChangeLog.create).not.toHaveBeenCalled();
  });

  it.each(CASES)('%s logs normally for an order with a sheet row', async (_n, state, write) => {
    const { tx, service } = setup({ ...SHEETLESS, sheetRowNumber: 2, ...state });
    await write(service);
    expect(tx.orderChangeLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sheetRowNumber: 2 }) })
    );
  });
});
