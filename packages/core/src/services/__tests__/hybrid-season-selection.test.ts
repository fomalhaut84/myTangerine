/**
 * HybridDataService.updateOrder — 같은 시즌 폼 문구 찾기 (#317)
 *
 * 웹에서 오주문 상품을 바꾸면 단가를 지어내지 않고, 같은 시즌 다른 주문의 폼 문구를 DB · 시트에 같은 값으로 넘긴다.
 * DB · 시트는 mock 이다(S-4).
 */
import { describe, it, expect, vi } from 'vitest';
import { HybridDataService } from '../hybrid-data-service.js';
import type { SheetService } from '../sheet-service.js';
import type { DatabaseService } from '../database-service.js';

const rows = [
  { _rowNumber: 10, 타임스탬프: '2025. 12. 1. 오전 10:00:00', '상품 선택': '5kg (23,000 / box)' },
  { _rowNumber: 11, 타임스탬프: '2025. 12. 3. 오후 2:00:00', '상품 선택': '10kg (38,000 / box)' },
  { _rowNumber: 12, 타임스탬프: '2024. 12. 3. 오후 2:00:00', '상품 선택': '10kg (35,000 / box)' }, // 지난 시즌
  { _rowNumber: 13, 타임스탬프: '읽을 수 없음', '상품 선택': '10kg (99,000 / box)' },
];

function databaseMode(getAllRows = vi.fn().mockResolvedValue(rows)) {
  const db = { getAllRows, updateOrder: vi.fn().mockResolvedValue(undefined) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new HybridDataService(null, db as unknown as DatabaseService, { mode: 'database', logger });
  return { service, db, logger };
}

describe('HybridDataService.updateOrder 시즌 폼 문구 (#317)', () => {
  it('상품을 바꾸면 같은 시즌의 그 상품 폼 문구를 넘긴다', async () => {
    const { service, db } = databaseMode();
    await service.updateOrder(10, { productType: '10kg' });
    expect(db.updateOrder).toHaveBeenCalledWith(
      10,
      { productType: '10kg', seasonSelection: '10kg (38,000 / box)' },
      'web'
    );
  });

  it('수량만 고치면 지금 상품의 시즌 문구를 넘긴다(원문에 단가가 없을 때 쓴다)', async () => {
    const { service, db } = databaseMode();
    await service.updateOrder(11, { quantity: 2 });
    expect(db.updateOrder).toHaveBeenCalledWith(11, { quantity: 2, seasonSelection: '10kg (38,000 / box)' }, 'web');
  });

  it('그 시즌에 그 상품 주문이 없으면 넘기지 않는다 — resolveProductEdit 이 거절한다', async () => {
    const { service, db } = databaseMode(vi.fn().mockResolvedValue([rows[0]]));
    await service.updateOrder(10, { productType: '10kg' });
    expect(db.updateOrder).toHaveBeenCalledWith(10, { productType: '10kg' }, 'web');
  });

  it('상품 · 수량 수정이 아니면 전체 주문을 읽지 않는다', async () => {
    const getAllRows = vi.fn().mockResolvedValue(rows);
    const { service } = databaseMode(getAllRows);
    await service.updateOrder(10, { recipient: { name: '새 이름' } });
    expect(getAllRows).not.toHaveBeenCalled();
  });

  it('읽기가 실패해도 수정을 막지 않고 경고를 남긴다', async () => {
    const { service, db, logger } = databaseMode(vi.fn().mockRejectedValue(new Error('db down')));
    await service.updateOrder(11, { quantity: 2 });
    expect(db.updateOrder).toHaveBeenCalledWith(11, { quantity: 2 }, 'web');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('[product-edit]'));
  });

  it('sheets 모드는 시트 원문에서 찾는다', async () => {
    const sheet = { getAllRows: vi.fn().mockResolvedValue(rows), updateOrder: vi.fn().mockResolvedValue(undefined) };
    const service = new HybridDataService(sheet as unknown as SheetService, null as unknown as DatabaseService, { mode: 'sheets' });
    await service.updateOrder(10, { productType: '10kg' });
    expect(sheet.updateOrder).toHaveBeenCalledWith(10, { productType: '10kg', seasonSelection: '10kg (38,000 / box)' });
  });
});
