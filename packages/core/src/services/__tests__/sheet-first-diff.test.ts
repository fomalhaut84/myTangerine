/**
 * 시트 우선 가져오기 변경 이력 비교 (#281 · 감사 ❌ 정정)
 * upsert 가 덮어쓰는 필드 전체(상태 · 송장 · 삭제 · 주문유형 · 상품 · 수량 · 주문자 · 보내는분 · 받으실분)를 비교한다.
 */
import { describe, it, expect } from 'vitest';
import { diffSheetFirstOverwrite } from '../sheet-first-diff.js';

const base = {
  status: '배송완료',
  trackingNumber: '123',
  deletedAt: null,
  orderType: 'customer',
  productSelection: '5kg',
  productType: '5kg',
  quantity: 1,
  quantity5kg: '1',
  quantity10kg: '',
  ordererName: null,
  ordererEmail: null,
  senderName: 'a',
  senderPhone: 'b',
  senderAddress: 'c',
  recipientName: 'd',
  recipientPhone: 'e',
  recipientAddress: 'f',
  timestampRaw: 't',
  validationError: null,
};

describe('diffSheetFirstOverwrite', () => {
  it('같으면 빈 객체', () => {
    expect(diffSheetFirstOverwrite({ ...base }, { ...base })).toEqual({});
  });

  it('상태 되돌림 · 송장 삭제 · 주문유형도 이력 대상', () => {
    const next = { ...base, status: '입금확인', trackingNumber: null, orderType: 'gift' };
    expect(diffSheetFirstOverwrite(next, base)).toEqual({
      status: { old: '배송완료', new: '입금확인' },
      trackingNumber: { old: '123', new: null },
      orderType: { old: 'customer', new: 'gift' },
    });
  });

  it('삭제 복원(deletedAt → null)은 이력에 남고, 시트에 삭제 칸이 없어(undefined) 유지되면 비교하지 않는다', () => {
    const deleted = { ...base, deletedAt: new Date('2026-11-19T00:00:00Z') };
    expect(diffSheetFirstOverwrite({ ...base, deletedAt: null }, deleted)).toEqual({
      deletedAt: { old: '2026-11-19T00:00:00.000Z', new: null },
    });
    expect(diffSheetFirstOverwrite({ ...base, deletedAt: undefined }, deleted)).toEqual({});
  });

  it("빈 문자열과 null 은 같다 · 숫자와 문자열 숫자는 같다", () => {
    expect(diffSheetFirstOverwrite({ ...base, ordererName: '', quantity: '1' }, base)).toEqual({});
  });
});
