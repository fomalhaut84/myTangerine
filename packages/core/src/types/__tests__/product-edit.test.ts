/**
 * 웹 상품 · 수량 수정 (#282) — 수정 값 → DB 필드 · 시트 칸
 *
 * 수정할 수 있는 상품은 5kg · 10kg 뿐이다(비상품은 2023 이후 주문 없음 · 사용자 2026-11-20).
 * 상품 → 수량 칸은 표 하나(PRODUCT_QUANTITY_COLUMN)로 정한다 — 상품이 늘면 표에만 더한다.
 */
import { describe, it, expect } from 'vitest';
import { resolveProductEdit, ProductEditError, EDITABLE_PRODUCT_TYPES } from '../product-edit.js';
import { validateProductSelection, extractQuantity, type SheetRow } from '../order.js';

describe('resolveProductEdit', () => {
  it('상품 · 수량을 함께 주면 그 상품 칸에만 수량을 쓰고 다른 칸은 비운다("0" 이 아니라 "")', () => {
    const r = resolveProductEdit({ productType: null, quantity: 1 }, { productType: '10kg', quantity: 3 });
    expect(r).toEqual({ productType: '10kg', quantity: 3, cells: { '상품 선택': '10kg', '5kg 수량': '', '10kg 수량': '3' } });
  });

  it('수량만 주면 지금 상품을 쓴다', () => {
    const r = resolveProductEdit({ productType: '5kg', quantity: 1 }, { quantity: 2 });
    expect(r?.cells).toEqual({ '상품 선택': '5kg', '5kg 수량': '2', '10kg 수량': '' });
  });

  it('상품만 주면 지금 수량을 유지한다', () => {
    const r = resolveProductEdit({ productType: '5kg', quantity: 4 }, { productType: '10kg' });
    expect(r).toMatchObject({ productType: '10kg', quantity: 4, cells: { '5kg 수량': '', '10kg 수량': '4' } });
  });

  it('둘 다 없으면 null(상품 수정 아님)', () => {
    expect(resolveProductEdit({ productType: '5kg', quantity: 1 }, {})).toBeNull();
  });

  it('지금 상품이 오류(null) · 비상품이면 수량만으로는 고칠 수 없다 — 상품을 함께 지정해야 한다', () => {
    expect(() => resolveProductEdit({ productType: null, quantity: 1 }, { quantity: 2 })).toThrow(ProductEditError);
    expect(() => resolveProductEdit({ productType: '비상품', quantity: 1 }, { quantity: 2 })).toThrow(ProductEditError);
  });

  it.each([0, -1, 1.5, Number.NaN])('수량 %s 는 거절한다(1 이상 정수)', (q) => {
    expect(() => resolveProductEdit({ productType: '5kg', quantity: 1 }, { quantity: q })).toThrow(ProductEditError);
  });

  it('수정할 수 없는 상품(비상품 등)은 거절한다', () => {
    expect(() =>
      resolveProductEdit({ productType: '5kg', quantity: 1 }, { productType: '비상품' as never })
    ).toThrow(ProductEditError);
    expect(EDITABLE_PRODUCT_TYPES).toEqual(['5kg', '10kg']);
  });

  it('쓴 칸을 다시 읽으면 같은 상품 · 수량이고 검증 오류가 없다(라벨 · PDF · 통계가 읽는 경로)', () => {
    for (const [productType, quantity] of [['5kg', 2], ['10kg', 3]] as const) {
      const { cells } = resolveProductEdit({ productType: null, quantity: 1 }, { productType, quantity })!;
      expect(validateProductSelection(cells['상품 선택'])).toMatchObject({ isValid: true, productType });
      expect(extractQuantity(cells as unknown as SheetRow)).toBe(quantity);
    }
  });
});
