/**
 * DatabaseService.updateOrder — 상품 · 수량 수정 (#282)
 *
 * 화면 · PDF · 통계는 DB 의 `productSelection` 원문 · 수량 문자열 · `validationError` 를 다시 해석한다.
 * 그래서 수정은 그 칸들을 함께 바꿔야 결과에 보인다. 최초 입력값(original_input)은 건드리지 않는다.
 * Prisma 는 mock 이다(S-4).
 */
import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { DatabaseService } from '../database-service.js';
import type { Config } from '../../config/config.js';

const ERROR_ORDER = {
  id: 7,
  sheetRowNumber: 12,
  status: '신규주문',
  version: 2,
  deletedAt: null,
  productSelection: '감귤 박스',
  productType: null,
  quantity5kg: '',
  quantity10kg: '2',
  quantity: 2,
  validationError: '유효하지 않은 상품 타입: "감귤 박스"',
  originalInput: { '상품 선택': '감귤 박스' },
};

function setup(order: Record<string, unknown> = ERROR_ORDER) {
  const tx = {
    order: {
      findFirst: vi.fn().mockResolvedValue(order),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue(order),
    },
    orderChangeLog: { create: vi.fn().mockResolvedValue({ id: 1 }) },
  };
  const root = { $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
  const service = new DatabaseService({} as Config, root as unknown as PrismaClient);
  const logChange = vi.spyOn(service.changeLogService, 'logChange');
  return { tx, service, logChange };
}

describe('DatabaseService.updateOrder — 상품 · 수량 (#282)', () => {
  it('상품 · 수량을 고치면 상품 선택 · 수량 칸 · 파생 수량을 맞추고 검증 오류를 지운다', async () => {
    const { tx, service } = setup();
    await service.updateOrder(12, { productType: '5kg', quantity: 3 }, 'web');

    const data = tx.order.updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({
      productSelection: '5kg',
      productType: '5kg',
      quantity5kg: '3',
      quantity10kg: '',
      quantity: 3,
      validationError: null,
    });
    expect(data).not.toHaveProperty('originalInput');
  });

  it('반대쪽 수량 칸은 "0" 이 아니라 "" 로 비운다(10kg 주문 수량이 0 으로 읽히지 않게)', async () => {
    const { tx, service } = setup({ ...ERROR_ORDER, productType: '5kg', productSelection: '5kg', quantity5kg: '1', quantity10kg: '', quantity: 1, validationError: null });
    await service.updateOrder(12, { productType: '10kg', quantity: 2 }, 'web');
    const data = tx.order.updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({ quantity5kg: '', quantity10kg: '2', quantity: 2 });
  });

  it('변경 이력에 상품 선택 원문 · 검증 오류 · 수량 칸의 이전 값을 남긴다', async () => {
    const { service, logChange } = setup();
    await service.updateOrder(12, { productType: '5kg', quantity: 3 }, 'web');
    const changes = logChange.mock.calls[0][0].fieldChanges;
    expect(changes).toMatchObject({
      productSelection: { old: '감귤 박스', new: '5kg' },
      productType: { old: null, new: '5kg' },
      quantity5kg: { old: '', new: '3' },
      quantity10kg: { old: '2', new: '' },
      quantity: { old: 2, new: 3 },
      validationError: { old: ERROR_ORDER.validationError, new: null },
    });
    expect(logChange.mock.calls[0][0]).toMatchObject({ changedBy: 'web', action: 'update', previousVersion: 2 });
  });

  it('지금 상품이 오류인데 수량만 주면 아무것도 쓰지 않고 던진다', async () => {
    const { tx, service } = setup();
    await expect(service.updateOrder(12, { quantity: 3 }, 'web')).rejects.toThrow('상품');
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });

  it('값이 그대로면 이력을 남기지 않는다', async () => {
    const same = { ...ERROR_ORDER, productSelection: '5kg', productType: '5kg', quantity5kg: '3', quantity10kg: '', quantity: 3, validationError: null };
    const { logChange, service } = setup(same);
    await service.updateOrder(12, { productType: '5kg', quantity: 3 }, 'web');
    expect(logChange).not.toHaveBeenCalled();
  });
});
