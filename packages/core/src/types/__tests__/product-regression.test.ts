/**
 * 상품 해석 · 수량 · 라벨 회귀 (#313)
 *
 * 카탈로그로 옮기기 전 동작을 그대로 고정한다. 과거 주문 해석이 바뀌면 통계 · 라벨 · 금액이 달라진다.
 */
import { describe, it, expect } from 'vitest';
import { extractQuantity, sheetRowToOrder, validateProductSelection, type Order, type SheetRow } from '../order.js';
import { LabelFormatter } from '../../formatters/label-formatter.js';
import type { Config } from '../../config/config.js';

function row(cells: Partial<SheetRow>): SheetRow {
  return cells as SheetRow;
}

describe('validateProductSelection (#313 회귀)', () => {
  it.each([
    ['5kg (23,000 / box)', '5kg'],
    ['10kg (38,000 / box)', '10kg'],
    ['비상품 (17,000 / box)', '비상품'],
    ['10kg 와 5kg', '10kg'], // 문자열에서 먼저 나온 상품
    ['5kg / 10kg', '5kg'],
    ['비상품 5kg', '비상품'], // 비상품이 무게보다 먼저
    ['5kg 비상품', '비상품'],
  ])('"%s" → %s', (selection, expected) => {
    expect(validateProductSelection(selection)).toEqual({ isValid: true, productType: expected, reason: '' });
  });

  it.each(['3kg', '15kg', '310kg', '감귤', '5 kg'])('"%s" → 무효', (selection) => {
    const result = validateProductSelection(selection);
    expect(result.isValid).toBe(false);
    expect(result.productType).toBeNull();
    expect(result.reason).toBe(`유효하지 않은 상품 타입: "${selection}"`);
  });

  it('빈 값 → 무효 · 비어있다는 사유', () => {
    expect(validateProductSelection('  ')).toEqual({
      isValid: false,
      productType: null,
      reason: '상품 선택이 비어있습니다',
    });
  });
});

describe('extractQuantity (#313 회귀)', () => {
  it('5kg 칸을 먼저 읽는다 — 10kg 주문이라도 5kg 칸에 값이 있으면 그 값', () => {
    expect(extractQuantity(row({ '상품 선택': '10kg', '5kg 수량': '2', '10kg 수량': '3' }))).toBe(2);
  });

  it('5kg 칸이 비면 10kg 칸', () => {
    expect(extractQuantity(row({ '5kg 수량': '', '10kg 수량': '3상자' }))).toBe(3);
  });

  it('5kg 칸에 숫자가 없으면 10kg 칸', () => {
    expect(extractQuantity(row({ '5kg 수량': '없음', '10kg 수량': '4' }))).toBe(4);
  });

  it('두 칸 다 비면 1', () => {
    expect(extractQuantity(row({ '5kg 수량': '', '10kg 수량': '' }))).toBe(1);
    expect(extractQuantity(row({}))).toBe(1);
  });

  it("'0' 은 0 으로 읽는다", () => {
    expect(extractQuantity(row({ '5kg 수량': '0', '10kg 수량': '2' }))).toBe(0);
  });
});

describe('LabelFormatter 요약 (#313 회귀)', () => {
  const config = {
    defaultSender: { name: '기본', address: '주소', phone: '010-0000-0000' },
  } as unknown as Config;

  function order(productType: Order['productType'], quantity: number, extra: Partial<Order> = {}): Order {
    return {
      timestamp: new Date('2025-12-01T10:00:00'),
      timestampRaw: '2025. 12. 1. 오전 10:00:00',
      status: '',
      sender: { name: '보내는이', address: '제주', phone: '010-1111-1111' },
      recipient: { name: '받는이', address: '서울', phone: '010-2222-2222' },
      productType,
      quantity,
      rowNumber: 2,
      ...extra,
    };
  }

  it('상품 줄 표기와 요약 — 비상품은 있을 때만, 5kg · 10kg 는 0 이어도 표시', () => {
    const text = new LabelFormatter(config).formatLabels([order('5kg', 2)]);
    expect(text).toContain('주문상품\n5kg / 2박스\n\n');
    expect(text).not.toContain('비상품 주문');
    expect(text).toContain('5kg 주문: 2박스\n10kg 주문: 0박스\n');
    expect(text).toContain('총 주문: 2박스\n');
  });

  it('세 상품이 섞이면 비상품 → 5kg → 10kg 순서로 요약', () => {
    const text = new LabelFormatter(config).formatLabels([order('10kg', 1), order('비상품', 3), order('5kg', 2)]);
    expect(text).toContain('비상품 / 3박스\n\n');
    expect(text).toContain('10kg / 1박스\n\n');
    expect(text).toContain('비상품 주문: 3박스\n5kg 주문: 2박스\n10kg 주문: 1박스\n');
    expect(text).toContain('총 주문: 6박스\n');
  });

  it('검증 오류 주문은 [오류] 줄 · 합계에서 빠진다', () => {
    const text = new LabelFormatter(config).formatLabels([
      order(null, 5, { validationError: '유효하지 않은 상품 타입: "3kg"' }),
      order('10kg', 1),
    ]);
    expect(text).toContain('[오류] 유효하지 않은 상품 타입: "3kg"\n\n');
    expect(text).toContain('총 주문: 1박스\n');
  });
});

describe('sheetRowToOrder 단가 (#317 — 원문 폼 문구가 정본)', () => {
  const base = {
    타임스탬프: '2024. 1. 8. 오전 10:00:00',
    비고: '',
    '보내는분 성함': '보내는이',
    '보내는분 주소 (도로명 주소로 부탁드려요)': '제주',
    '보내는분 연락처 (핸드폰번호)': '01011111111',
    '받으실분 성함': '받는이',
    '받으실분 주소 (도로명 주소로 부탁드려요)': '서울',
    '받으실분 연락처 (핸드폰번호)': '01022222222',
    '5kg 수량': '',
    '10kg 수량': '3',
    _rowNumber: 5,
  } as unknown as SheetRow;

  it('2024 년 1월 `10kg (30,000 / box)` 는 30,000 — 달력 연도 가격표(35,000)가 아니다', () => {
    const order = sheetRowToOrder({ ...base, '상품 선택': '10kg (30,000 / box)' } as SheetRow);
    expect(order).toMatchObject({ productType: '10kg', quantity: 3, unitPrice: 30000 });
  });

  it('원문에 단가가 없으면 null', () => {
    expect(sheetRowToOrder({ ...base, '상품 선택': '10kg' } as SheetRow).unitPrice).toBeNull();
  });
});
