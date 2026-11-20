/**
 * SheetService.updateOrder — 상품 · 수량 칸 (#282)
 *
 * DB 와 같은 함수(resolveProductEdit)로 `상품 선택` · `5kg 수량` · `10kg 수량` 세 칸을 함께 쓴다.
 * 실제 시트에는 닿지 않는다(S-4) — 칸 쓰기 · 행 읽기는 mock.
 */
import { describe, it, expect, vi } from 'vitest';
import { SheetService } from '../sheet-service.js';
import type { SheetRow } from '../../types/order.js';

function service(current: Partial<SheetRow> | null) {
  const s = Object.create(SheetService.prototype) as SheetService;
  const updateRowCells = vi.fn().mockResolvedValue(undefined);
  Object.assign(s, {
    updateRowCells,
    getOrderByRowNumber: vi.fn().mockResolvedValue(current),
  });
  return { s, updateRowCells };
}

describe('SheetService.updateOrder — 상품 · 수량 (#282)', () => {
  it('상품 · 수량을 주면 세 칸을 함께 쓰고 다른 수량 칸은 비운다', async () => {
    const { s, updateRowCells } = service({ '상품 선택': '감귤 박스', '5kg 수량': '', '10kg 수량': '2' });
    await s.updateOrder(12, { productType: '5kg', quantity: 3, seasonSelection: '5kg (23,000 / box)' });
    expect(updateRowCells).toHaveBeenCalledWith(12, { '상품 선택': '5kg (23,000 / box)', '5kg 수량': '3', '10kg 수량': '' });
  });

  it('수량만 주면 시트의 지금 상품(폼 원문)을 해석해 그 칸에 쓰고 원문(단가)은 그대로 둔다 (#317)', async () => {
    const { s, updateRowCells } = service({ '상품 선택': '10kg (38,000 / box)', '5kg 수량': '', '10kg 수량': '' });
    await s.updateOrder(12, { quantity: 2 });
    expect(updateRowCells).toHaveBeenCalledWith(12, { '상품 선택': '10kg (38,000 / box)', '5kg 수량': '', '10kg 수량': '2' });
  });

  it('지금 상품이 오류인데 수량만 주면 쓰지 않고 던진다', async () => {
    const { s, updateRowCells } = service({ '상품 선택': '감귤 박스', '5kg 수량': '', '10kg 수량': '' });
    await expect(s.updateOrder(12, { quantity: 2 })).rejects.toThrow('상품');
    expect(updateRowCells).not.toHaveBeenCalled();
  });

  it('상품 · 수량이 없는 수정은 시트 행을 읽지 않는다', async () => {
    const { s, updateRowCells } = service(null);
    await s.updateOrder(12, { recipient: { name: '새 이름' } });
    expect(updateRowCells).toHaveBeenCalledWith(12, { '받으실분 성함': '새 이름' });
    expect((s as unknown as { getOrderByRowNumber: ReturnType<typeof vi.fn> }).getOrderByRowNumber).not.toHaveBeenCalled();
  });
});
