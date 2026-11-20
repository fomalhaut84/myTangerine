/**
 * 주문 금액 = 원문 단가 × 수량 (#317)
 *
 * 단가의 정본은 구글 폼 문구다. 코드 가격표로 다시 계산하지 않는다 — 가격이 바뀌어도 과거 주문 금액은 그대로.
 */
import { describe, it, expect, vi } from 'vitest';
import { sheetRowToOrder, type Order, type SheetRow } from '@mytangerine/core';
import { calculateOrderAmount } from '../../utils/stats.js';

function row(selection: string, qty10 = '', qty5 = '', timestamp = '2025. 12. 1. 오전 10:00:00'): SheetRow {
  return {
    타임스탬프: timestamp,
    비고: '',
    '보내는분 성함': '보내는이',
    '보내는분 주소 (도로명 주소로 부탁드려요)': '제주',
    '보내는분 연락처 (핸드폰번호)': '01011111111',
    '받으실분 성함': '받는이',
    '받으실분 주소 (도로명 주소로 부탁드려요)': '서울',
    '받으실분 연락처 (핸드폰번호)': '01022222222',
    '상품 선택': selection,
    '5kg 수량': qty5,
    '10kg 수량': qty10,
    _rowNumber: 7,
  } as unknown as SheetRow;
}

describe('calculateOrderAmount (#317)', () => {
  it('원문 단가 × 수량', () => {
    expect(calculateOrderAmount(sheetRowToOrder(row('10kg (38,000 / box)', '2')))).toBe(76000);
    expect(calculateOrderAmount(sheetRowToOrder(row('5kg (23,000 / box)', '', '3')))).toBe(69000);
    expect(calculateOrderAmount(sheetRowToOrder(row('비상품 (17,000 / box)')))).toBe(17000);
  });

  it('해를 넘긴 시즌 주문은 그 원문 단가 — 2024-01 `10kg (30,000 / box)` 는 30,000 (예전 가격표 계산 35,000)', () => {
    const order = sheetRowToOrder(row('10kg (30,000 / box)', '1', '', '2024. 1. 8. 오전 10:00:00'));
    expect(calculateOrderAmount(order)).toBe(30000);
  });

  it('검증 오류 주문(상품 없음)은 0', () => {
    expect(calculateOrderAmount(sheetRowToOrder(row('3kg (15,000 / box)')))).toBe(0);
  });

  it('원문에 단가가 없으면 0 이고 한 번만 경고한다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const order = { ...sheetRowToOrder(row('10kg', '2')), rowNumber: 991 } as Order;
    expect(calculateOrderAmount(order)).toBe(0);
    expect(calculateOrderAmount(order)).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('단가가 없어');
    warn.mockRestore();
  });
});
