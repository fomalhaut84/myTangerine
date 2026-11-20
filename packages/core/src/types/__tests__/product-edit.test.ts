/**
 * 웹 상품 · 수량 수정 (#282) — 수정 값 → DB 필드 · 시트 칸
 *
 * 수정할 수 있는 상품은 5kg · 10kg 뿐이다(비상품은 2023 이후 주문 없음 · 사용자 2026-11-20).
 * 상품 → 수량 칸은 표 하나(PRODUCT_QUANTITY_COLUMN)로 정한다 — 상품이 늘면 표에만 더한다.
 */
import { describe, it, expect } from 'vitest';
import { resolveProductEdit, ProductEditError, EDITABLE_PRODUCT_TYPES } from '../product-edit.js';
import { validateProductSelection, extractQuantity, type SheetRow } from '../order.js';
import { parseUnitPrice } from '../../catalog/form-selection.js';

const S5 = '5kg (23,000 / box)';
const S10 = '10kg (38,000 / box)';

describe('resolveProductEdit', () => {
  it('상품 · 수량을 함께 주면 그 상품 칸에만 수량을 쓰고 다른 칸은 비운다("0" 이 아니라 "")', () => {
    const r = resolveProductEdit({ productType: null, quantity: 1 }, { productType: '10kg', quantity: 3, seasonSelection: S10 });
    expect(r).toEqual({ productType: '10kg', quantity: 3, cells: { '상품 선택': S10, '5kg 수량': '', '10kg 수량': '3' } });
  });

  it('수량만 주면 지금 상품 · 지금 원문(단가)을 그대로 쓴다 (#317)', () => {
    const r = resolveProductEdit({ productType: '5kg', quantity: 1, productSelection: S5 }, { quantity: 2 });
    expect(r?.cells).toEqual({ '상품 선택': S5, '5kg 수량': '2', '10kg 수량': '' });
  });

  it('상품을 바꾸면 같은 시즌 폼 문구를 쓰고 지금 수량을 유지한다 (#317)', () => {
    const r = resolveProductEdit({ productType: '5kg', quantity: 4, productSelection: S5 }, { productType: '10kg', seasonSelection: S10 });
    expect(r).toMatchObject({ productType: '10kg', quantity: 4, cells: { '상품 선택': S10, '5kg 수량': '', '10kg 수량': '4' } });
  });

  it('같은 상품을 다시 주면 지금 원문 유지 — 시즌 문구보다 우선 (#317)', () => {
    const r = resolveProductEdit(
      { productType: '10kg', quantity: 1, productSelection: '10kg (30,000 / box)' },
      { productType: '10kg', quantity: 2, seasonSelection: S10 }
    );
    expect(r?.cells['상품 선택']).toBe('10kg (30,000 / box)');
  });

  it('폼 단가를 찾지 못하면 거절한다 — 단가를 지어내지 않는다 (#317)', () => {
    expect(() => resolveProductEdit({ productType: '5kg', quantity: 1, productSelection: S5 }, { productType: '10kg' })).toThrow(
      /폼 단가를 찾지 못했습니다/
    );
    // 다른 상품 문구 · 단가 없는 문구는 쓰지 않는다
    expect(() =>
      resolveProductEdit({ productType: '5kg', quantity: 1, productSelection: S5 }, { productType: '10kg', seasonSelection: S5 })
    ).toThrow(ProductEditError);
    expect(() =>
      resolveProductEdit({ productType: '5kg', quantity: 1, productSelection: S5 }, { productType: '10kg', seasonSelection: '10kg' })
    ).toThrow(ProductEditError);
  });

  it('지금 원문에 단가가 없으면(예전 웹 수정 "5kg") 수량만 고쳐도 시즌 문구로 채운다', () => {
    const r = resolveProductEdit({ productType: '5kg', quantity: 1, productSelection: '5kg' }, { quantity: 2, seasonSelection: S5 });
    expect(r?.cells['상품 선택']).toBe(S5);
  });

  it('둘 다 없으면 null(상품 수정 아님)', () => {
    expect(resolveProductEdit({ productType: '5kg', quantity: 1 }, {})).toBeNull();
  });

  it('지금 상품이 오류(null) · 비상품이면 수량만으로는 고칠 수 없다 — 상품을 함께 지정해야 한다', () => {
    expect(() => resolveProductEdit({ productType: null, quantity: 1 }, { quantity: 2 })).toThrow(ProductEditError);
    expect(() => resolveProductEdit({ productType: '비상품', quantity: 1 }, { quantity: 2 })).toThrow(ProductEditError);
  });

  it.each([0, -1, 1.5, Number.NaN])('수량 %s 는 거절한다(1 이상 정수)', (q) => {
    expect(() => resolveProductEdit({ productType: '5kg', quantity: 1, productSelection: S5 }, { quantity: q })).toThrow(ProductEditError);
  });

  it('수정할 수 없는 상품(비상품 등)은 거절한다', () => {
    expect(() =>
      resolveProductEdit({ productType: '5kg', quantity: 1 }, { productType: '비상품' as never })
    ).toThrow(ProductEditError);
    expect(EDITABLE_PRODUCT_TYPES).toEqual(['5kg', '10kg']);
  });

  it('쓴 칸을 다시 읽으면 같은 상품 · 수량 · 단가이고 검증 오류가 없다(라벨 · PDF · 통계가 읽는 경로)', () => {
    for (const [productType, quantity, selection, price] of [['5kg', 2, S5, 23000], ['10kg', 3, S10, 38000]] as const) {
      const { cells } = resolveProductEdit({ productType: null, quantity: 1 }, { productType, quantity, seasonSelection: selection })!;
      expect(validateProductSelection(cells['상품 선택'])).toMatchObject({ isValid: true, productType });
      expect(extractQuantity(cells as unknown as SheetRow)).toBe(quantity);
      expect(parseUnitPrice(cells['상품 선택'])).toBe(price);
    }
  });
});
