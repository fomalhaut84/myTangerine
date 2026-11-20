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

const S5 = '5kg (23,000 / box)';
const S10 = '10kg (38,000 / box)';

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
    await service.updateOrder(12, { productType: '5kg', quantity: 3, seasonSelection: S5 }, 'web');

    const data = tx.order.updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({
      productSelection: S5, // #317 단가가 든 폼 문구
      productType: '5kg',
      quantity5kg: '3',
      quantity10kg: '',
      quantity: 3,
      validationError: null,
    });
    expect(data).not.toHaveProperty('originalInput');
  });

  it('반대쪽 수량 칸은 "0" 이 아니라 "" 로 비운다(10kg 주문 수량이 0 으로 읽히지 않게)', async () => {
    const { tx, service } = setup({ ...ERROR_ORDER, productType: '5kg', productSelection: S5, quantity5kg: '1', quantity10kg: '', quantity: 1, validationError: null });
    await service.updateOrder(12, { productType: '10kg', quantity: 2, seasonSelection: S10 }, 'web');
    const data = tx.order.updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({ quantity5kg: '', quantity10kg: '2', quantity: 2 });
  });

  it('변경 이력에 상품 선택 원문 · 검증 오류 · 수량 칸의 이전 값을 남긴다', async () => {
    const { service, logChange } = setup();
    await service.updateOrder(12, { productType: '5kg', quantity: 3, seasonSelection: S5 }, 'web');
    const changes = logChange.mock.calls[0][0].fieldChanges;
    expect(changes).toMatchObject({
      productSelection: { old: '감귤 박스', new: S5 },
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

  it('빈 수량 칸(null)을 "" 로 쓰는 것은 변경이 아니다', async () => {
    const before = { ...ERROR_ORDER, productSelection: S5, productType: '5kg', quantity5kg: '1', quantity10kg: null, quantity: 1, validationError: null };
    const { service, logChange } = setup(before);
    await service.updateOrder(12, { productType: '5kg', quantity: 2 }, 'web');
    expect(logChange.mock.calls[0][0].fieldChanges).not.toHaveProperty('quantity10kg');
  });

  it('값이 그대로면 이력을 남기지 않는다', async () => {
    const same = { ...ERROR_ORDER, productSelection: S5, productType: '5kg', quantity5kg: '3', quantity10kg: '', quantity: 3, validationError: null };
    const { logChange, service } = setup(same);
    await service.updateOrder(12, { productType: '5kg', quantity: 3 }, 'web');
    expect(logChange).not.toHaveBeenCalled();
  });

  it('#317 수량만 고치면 지금 원문(단가)을 그대로 둔다', async () => {
    const before = { ...ERROR_ORDER, productSelection: '10kg (30,000 / box)', productType: '10kg', quantity5kg: '', quantity10kg: '1', quantity: 1, validationError: null };
    const { tx, service } = setup(before);
    await service.updateOrder(12, { quantity: 2 }, 'web');
    expect(tx.order.updateMany.mock.calls[0][0].data).toMatchObject({ productSelection: '10kg (30,000 / box)', quantity10kg: '2' });
  });

  it('#317 상품을 바꾸는데 같은 시즌 폼 문구가 없으면 아무것도 쓰지 않고 던진다', async () => {
    const before = { ...ERROR_ORDER, productSelection: S5, productType: '5kg', quantity5kg: '1', quantity10kg: '', quantity: 1, validationError: null };
    const { tx, service } = setup(before);
    await expect(service.updateOrder(12, { productType: '10kg' }, 'web')).rejects.toThrow('폼 단가를 찾지 못했습니다');
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });

  // 회귀: PR #321 Codex P2 — API 가 확정한 원문을 DB 도 그대로 쓴다(시트와 같은 값)
  it('#322 확정 원문(resolvedSelection)을 지금 원문보다 먼저 쓴다', async () => {
    const before = { ...ERROR_ORDER, productSelection: '10kg (35,000 / box)', productType: '10kg', quantity5kg: '', quantity10kg: '1', quantity: 1, validationError: null };
    const { tx, service } = setup(before);
    await service.updateOrder(12, { productType: '10kg', quantity: 2, resolvedSelection: S10 }, 'web');
    expect(tx.order.updateMany.mock.calls[0][0].data).toMatchObject({ productSelection: S10, quantity10kg: '2' });
  });
});
