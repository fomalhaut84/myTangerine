import { describe, it, expect } from 'vitest';
import {
  PRODUCT_CATALOG,
  QUANTITY_STORAGE_FIELD,
  editableProductsOf,
  findProduct,
  quantityCellsFromStorage,
  quantityColumnsOf,
  quantityStorageFromRow,
  readQuantity,
  resolveProductSelection,
  type ProductCatalog,
} from '../products.js';
import { pricesForYear } from '../prices.js';
import { LabelFormatter } from '../../formatters/label-formatter.js';
import type { Config } from '../../config/config.js';
import type { Order } from '../../types/order.js';

/** 폼에 3kg 가 생긴 경우를 흉내 낸 카탈로그 */
const WITH_3KG: ProductCatalog = [
  ...PRODUCT_CATALOG,
  { id: '3kg', selection: { kind: 'word', word: '3kg' }, quantityColumn: '3kg 수량', editable: true, alwaysInSummary: false },
];

describe('PRODUCT_CATALOG 불변 조건', () => {
  it('id 가 겹치지 않는다', () => {
    const ids = PRODUCT_CATALOG.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('웹에서 고를 수 있는 상품은 수량 칸이 있다', () => {
    for (const product of PRODUCT_CATALOG.filter((p) => p.editable)) {
      expect(product.quantityColumn, product.id).not.toBeNull();
    }
  });

  it('모든 수량 칸에 DB 저장 칼럼이 있다', () => {
    expect(Object.keys(QUANTITY_STORAGE_FIELD)).toEqual([...quantityColumnsOf()]);
  });

  it('현재 목록 — 수량 칸 순서 · 웹 선택 상품', () => {
    expect(quantityColumnsOf()).toEqual(['5kg 수량', '10kg 수량']);
    expect(editableProductsOf()).toEqual(['5kg', '10kg']);
  });
});

describe('resolveProductSelection', () => {
  it('실제 카탈로그에서 3kg 는 무효', () => {
    expect(resolveProductSelection('3kg (15,000 / box)')).toBeNull();
  });

  it('카탈로그에 더하면 3kg 를 알아본다', () => {
    expect(resolveProductSelection('3kg (15,000 / box)', WITH_3KG)).toBe('3kg');
    expect(resolveProductSelection('13kg', WITH_3KG)).toBeNull();
  });

  it('여럿이면 원문에서 먼저 나온 상품', () => {
    expect(resolveProductSelection('3kg 또는 10kg', WITH_3KG)).toBe('3kg');
    expect(resolveProductSelection('10kg 또는 3kg', WITH_3KG)).toBe('10kg');
  });

  it('정규식 특수문자가 들어간 단어도 글자 그대로 맞춘다', () => {
    const catalog: ProductCatalog = [
      { id: '2.5kg', selection: { kind: 'word', word: '2.5kg' }, quantityColumn: null, editable: false, alwaysInSummary: false },
    ];
    expect(resolveProductSelection('2.5kg', catalog)).toBe('2.5kg');
    expect(resolveProductSelection('2x5kg', catalog)).toBeNull();
  });
});

describe('readQuantity', () => {
  it('새 상품 수량 칸도 카탈로그 순서 끝에서 읽는다', () => {
    expect(readQuantity({ '3kg 수량': '4' }, WITH_3KG)).toBe(4);
    expect(readQuantity({ '3kg 수량': '4' })).toBe(1); // 실제 카탈로그는 그 칸을 모른다
  });
});

describe('수량 저장 칼럼 변환', () => {
  it('시트 행 → DB 원문 칼럼 (비거나 0 이면 빈 문자열)', () => {
    expect(quantityStorageFromRow({ '5kg 수량': '2', '10kg 수량': undefined })).toEqual({
      quantity5kg: '2',
      quantity10kg: '',
    });
  });

  it('DB 원문 칼럼 → 시트 칸', () => {
    expect(quantityCellsFromStorage({ quantity5kg: '', quantity10kg: '3' })).toEqual({
      '5kg 수량': '',
      '10kg 수량': '3',
    });
  });
});

describe('pricesForYear', () => {
  const table = { '2025': { '5kg': 23000 }, '2027': { '10kg': 40000 } };

  it('그 해 → 이전 해 → 가장 오래된 해', () => {
    expect(pricesForYear(2027, table)).toEqual({ '10kg': 40000 });
    expect(pricesForYear(2026, table)).toEqual({ '5kg': 23000 });
    expect(pricesForYear(2020, table)).toEqual({ '5kg': 23000 });
  });

  it('표가 비면 대체값', () => {
    expect(pricesForYear(2025, {})).toEqual({ '5kg': 20000, '10kg': 35000 });
  });
});

describe('LabelFormatter 와 카탈로그', () => {
  const config = {
    defaultSender: { name: '기본', address: '주소', phone: '010-0000-0000' },
  } as unknown as Config;

  const order = (productType: string, quantity: number): Order =>
    ({
      timestamp: new Date('2026-12-01T10:00:00'),
      timestampRaw: '2026. 12. 1. 오전 10:00:00',
      status: '',
      sender: { name: '보내는이', address: '제주', phone: '010-1111-1111' },
      recipient: { name: '받는이', address: '서울', phone: '010-2222-2222' },
      productType,
      quantity,
      rowNumber: 2,
    }) as Order;

  it('새 상품도 라벨 줄과 요약 합계에 들어간다 (조용히 빠지지 않는다)', () => {
    const text = new LabelFormatter(config, WITH_3KG).formatLabels([order('3kg', 2), order('10kg', 1)]);
    expect(text).toContain('3kg / 2박스\n\n');
    expect(text).toContain('5kg 주문: 0박스\n10kg 주문: 1박스\n3kg 주문: 2박스\n');
    expect(text).toContain('총 주문: 3박스\n');
  });

  it('findProduct 는 카탈로그 밖 상품에 undefined', () => {
    expect(findProduct('3kg')).toBeUndefined();
    expect(findProduct(null)).toBeUndefined();
    expect(findProduct('3kg', WITH_3KG)?.quantityColumn).toBe('3kg 수량');
  });
});

describe('카탈로그 단언 · 가격표 동결 (#313 리뷰)', () => {
  it('수량 칸 없는 상품을 웹 선택으로 두면 멈춘다', () => {
    const broken: ProductCatalog = [
      { id: '선물세트', selection: { kind: 'includes', text: '선물세트' }, quantityColumn: null, editable: true, alwaysInSummary: false },
    ];
    expect(() => editableProductsOf(broken)).toThrow('수량 칸이 없습니다 — 선물세트');
  });

  it('가격표는 바꿀 수 없다', async () => {
    const { PRODUCT_PRICES_BY_YEAR } = await import('../prices.js');
    expect(Object.isFrozen(PRODUCT_PRICES_BY_YEAR)).toBe(true);
    expect(Object.isFrozen(PRODUCT_PRICES_BY_YEAR['2025'])).toBe(true);
  });
});
