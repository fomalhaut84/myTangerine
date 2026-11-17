import { describe, it, expect } from 'vitest';
import { resolveOrderIdType, hasSheetRow } from '../../utils/order-id-type.js';

describe('resolveOrderIdType (#199)', () => {
  it('uses dbId for a DB-only claim (no sheet row)', () => {
    expect(resolveOrderIdType({ orderType: 'claim', dbId: 12, rowNumber: 0 })).toBe('dbId');
    expect(resolveOrderIdType({ orderType: 'claim', dbId: 12, rowNumber: undefined })).toBe('dbId');
  });

  // 회귀: #199 — 시트에 직접 입력된 배송사고 행이 dbId 로 표시돼 배송완료 가드에 막혔다
  it('uses rowNumber for a claim that has a sheet row', () => {
    expect(resolveOrderIdType({ orderType: 'claim', dbId: 1487, rowNumber: 391 })).toBe('rowNumber');
  });

  it('uses rowNumber for a claim without dbId (sheets mode)', () => {
    expect(resolveOrderIdType({ orderType: 'claim', dbId: undefined, rowNumber: 391 })).toBe('rowNumber');
    expect(resolveOrderIdType({ orderType: 'claim', dbId: null, rowNumber: 0 })).toBe('rowNumber');
  });

  it('uses rowNumber for regular orders even with dbId', () => {
    expect(resolveOrderIdType({ orderType: 'customer', dbId: 5, rowNumber: 10 })).toBe('rowNumber');
    expect(resolveOrderIdType({ orderType: 'gift', dbId: 5, rowNumber: 0 })).toBe('rowNumber');
  });

  it('treats only positive integers as a sheet row', () => {
    expect(hasSheetRow({ rowNumber: 2 })).toBe(true);
    expect(hasSheetRow({ rowNumber: 0 })).toBe(false);
    expect(hasSheetRow({ rowNumber: -1 })).toBe(false);
    expect(hasSheetRow({ rowNumber: 1.5 })).toBe(false);
    expect(hasSheetRow({ rowNumber: null })).toBe(false);
  });
});
