/**
 * 웹 상품 · 수량 수정 (#282) — 수정 가능 판정 · 보낼 값
 * 서버(PATCH)가 최종 판정한다. 화면은 바뀐 값만 보내고, 오류 주문은 상품을 고르게 한다.
 */
import { describe, it, expect } from 'vitest';
import { canEditProduct, buildProductEditPayload, EDITABLE_PRODUCTS } from '../product-edit';

const order = (o: Partial<Parameters<typeof canEditProduct>[0]> = {}) => ({
  status: '신규주문' as const,
  orderType: 'customer' as const,
  isDeleted: false,
  productType: '5kg' as const,
  quantity: 2,
  validationError: undefined as string | undefined,
  ...o,
});

describe('canEditProduct', () => {
  it('신규주문 · 입금확인만', () => {
    expect(canEditProduct(order())).toBe(true);
    expect(canEditProduct(order({ status: '입금확인' }))).toBe(true);
    expect(canEditProduct(order({ status: '배송완료' }))).toBe(false);
  });

  it('배송사고 · 삭제된 주문은 아니다', () => {
    expect(canEditProduct(order({ orderType: 'claim' }))).toBe(false);
    expect(canEditProduct(order({ isDeleted: true }))).toBe(false);
  });

  it('상품 목록은 5kg · 10kg', () => {
    expect(EDITABLE_PRODUCTS).toEqual(['5kg', '10kg']);
  });
});

describe('buildProductEditPayload', () => {
  it('바뀐 값만 보낸다', () => {
    expect(buildProductEditPayload(order(), { productType: '5kg', quantity: 3 })).toEqual({ ok: true, payload: { quantity: 3 } });
    expect(buildProductEditPayload(order(), { productType: '10kg', quantity: 2 })).toEqual({ ok: true, payload: { productType: '10kg' } });
    expect(buildProductEditPayload(order(), { productType: '5kg', quantity: 2 })).toEqual({ ok: true, payload: {} });
  });

  it('오류 주문은 상품을 골라야 하고, 고르면 상품 · 수량을 함께 보낸다', () => {
    const broken = order({ productType: null, validationError: '유효하지 않은 상품 타입' });
    expect(buildProductEditPayload(broken, { quantity: 2 })).toEqual({ ok: false, error: '상품(5kg · 10kg)을 골라 주세요.' });
    expect(buildProductEditPayload(broken, { productType: '10kg', quantity: 2 })).toEqual({
      ok: true,
      payload: { productType: '10kg', quantity: 2 },
    });
  });

  it.each([0, -1, 1.5, Number.NaN, 1000])('수량 %s 는 오류', (q) => {
    const r = buildProductEditPayload(order(), { productType: '5kg', quantity: q });
    expect(r.ok).toBe(false);
  });
});
