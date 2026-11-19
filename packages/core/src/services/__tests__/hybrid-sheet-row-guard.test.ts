/**
 * hybrid 쓰기 전 시트 행 확인 (#258)
 *
 * DB 는 주문을 시트 행 번호로 기억한다. 시트 행이 밀리면(중간 행 삭제 · 폼이 위에 끼워 넣기) 웹 수정이
 * 지금 그 번호에 있는 **다른 고객 주문**의 시트 행을 바꾼다. 그래서 DB 를 쓰기 전에 대상 행들의 시트
 * `타임스탬프` 를 한 번에 읽어 DB 주문과 같은지 본다. 하나라도 다르면 요청 전체를 거절한다(사용자 결정 2026-11-19):
 * DB · 시트 모두 바꾸지 않고 409. 시트를 읽지 못하면 DB 만 쓰고 시트는 건너뛴다(부분 저장 · 사용자 결정 2026-11-19).
 *
 * SheetService · DatabaseService 는 mock 이다(S-4).
 */

import { describe, it, expect, vi } from 'vitest';
import { HybridDataService } from '../hybrid-data-service.js';
import { SheetRowMismatchError, SHEET_SYNC_WARNING } from '../hybrid-write.js';
import type { SheetService } from '../sheet-service.js';
import type { DatabaseService } from '../database-service.js';
import { parseKoreanTimestamp } from '../../types/order.js';

const A = '2026. 11. 19. 오전 10:26:32';
const B = '2026. 1. 7. 오후 7:49:40';

function setup(opts: {
  sheet: Record<number, string>;
  db: Record<number, string>;
  sheetReadFails?: boolean;
}) {
  const sheet = {
    updateOrderStatus: vi.fn().mockResolvedValue(undefined),
    markDelivered: vi.fn().mockResolvedValue(undefined),
    getTimestampsByRows: opts.sheetReadFails
      ? vi.fn().mockRejectedValue(new Error('quota'))
      : vi.fn(async (rows: number[]) => new Map(rows.map((n) => [n, opts.sheet[n] ?? '']))),
  };
  const db = {
    updateOrderStatus: vi.fn().mockResolvedValue(undefined),
    markDelivered: vi.fn().mockResolvedValue(undefined),
    markSheetSyncFailed: vi.fn(),
    getOrderTimestampsByRows: vi.fn(
      async (rows: number[]) =>
        new Map(
          rows
            .filter((n) => opts.db[n] !== undefined)
            .map((n) => [n, { timestamp: parseKoreanTimestamp(opts.db[n]), timestampRaw: opts.db[n] }])
        )
    ),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new HybridDataService(sheet as unknown as SheetService, db as unknown as DatabaseService, {
    mode: 'hybrid',
    logger,
  });
  return { service, sheet, db, logger };
}

describe('hybrid 쓰기 전 시트 행 확인 (#258)', () => {
  it('시트 행이 DB 주문과 같으면 DB → 시트 순서로 쓴다', async () => {
    const { service, sheet, db } = setup({ sheet: { 391: A }, db: { 391: A } });
    await service.updateOrderStatus(391, '입금확인');
    expect(sheet.getTimestampsByRows).toHaveBeenCalledWith([391]);
    expect(db.updateOrderStatus).toHaveBeenCalledTimes(1);
    expect(sheet.updateOrderStatus).toHaveBeenCalledTimes(1);
  });

  it('표시 형식만 다르면(점·공백) 같은 주문', async () => {
    const { service, sheet } = setup({ sheet: { 391: '2026. 11. 19 오전 10:26:32' }, db: { 391: A } });
    await service.updateOrderStatus(391, '입금확인');
    expect(sheet.updateOrderStatus).toHaveBeenCalledTimes(1);
  });

  it('시트 행이 다른 주문이면 DB · 시트 모두 쓰지 않고 409', async () => {
    const { service, sheet, db, logger } = setup({ sheet: { 391: B }, db: { 391: A } });
    const error = await service.updateOrderStatus(391, '입금확인').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SheetRowMismatchError);
    expect((error as SheetRowMismatchError).statusCode).toBe(409);
    expect((error as SheetRowMismatchError).message).toContain('391');
    expect((error as SheetRowMismatchError).message).toContain('변경된 내용은 없습니다');
    expect(db.updateOrderStatus).not.toHaveBeenCalled();
    expect(sheet.updateOrderStatus).not.toHaveBeenCalled();
    expect(db.markSheetSyncFailed).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('[hybrid-guard]'));
  });

  it('여러 행 중 하나라도 다르면 요청 전체를 거절한다 · 시트는 한 번에 읽는다', async () => {
    const { service, sheet, db } = setup({ sheet: { 390: A, 391: B }, db: { 390: A, 391: A } });
    await expect(service.markDelivered([390, 391], 'T-1')).rejects.toBeInstanceOf(SheetRowMismatchError);
    expect(sheet.getTimestampsByRows).toHaveBeenCalledTimes(1);
    expect(sheet.getTimestampsByRows).toHaveBeenCalledWith([390, 391]);
    expect(db.markDelivered).not.toHaveBeenCalled();
    expect(sheet.markDelivered).not.toHaveBeenCalled();
  });

  it('시트 행이 비어 있으면(행이 사라짐) 쓰지 않는다', async () => {
    const { service, db } = setup({ sheet: {}, db: { 391: A } });
    await expect(service.updateOrderStatus(391, '입금확인')).rejects.toBeInstanceOf(SheetRowMismatchError);
    expect(db.updateOrderStatus).not.toHaveBeenCalled();
  });

  it('시트를 읽지 못하면 DB 만 쓰고 시트는 쓰지 않는다 — 부분 저장 경고 · 실패 표시', async () => {
    const { service, sheet, db } = setup({ sheet: { 391: A }, db: { 391: A }, sheetReadFails: true });
    const outcome = await service.updateOrderStatus(391, '입금확인');
    expect(outcome).toEqual({ partial: true, warnings: [SHEET_SYNC_WARNING] });
    expect(db.updateOrderStatus).toHaveBeenCalledTimes(1);
    expect(sheet.updateOrderStatus).not.toHaveBeenCalled();
    expect(db.markSheetSyncFailed).toHaveBeenCalledWith([391], expect.stringContaining('could not verify sheet rows'));
  });

  it('DB 에 그 행 번호의 주문이 없으면 불일치 — 일괄 쓰기가 확인 안 된 행에 시트를 쓰지 않는다 (사전 리뷰 M-1)', async () => {
    const { service, sheet, db } = setup({ sheet: { 390: A, 391: B }, db: { 390: A } });
    const error = await service.markDelivered([390, 391], 'T-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SheetRowMismatchError);
    expect((error as SheetRowMismatchError).rows).toEqual([391]);
    expect(sheet.getTimestampsByRows).toHaveBeenCalledWith([390]);
    expect(db.markDelivered).not.toHaveBeenCalled();
    expect(sheet.markDelivered).not.toHaveBeenCalled();
  });

  it('sheets 모드는 비교할 DB 가 없으므로 확인하지 않는다', async () => {
    const { sheet, db } = setup({ sheet: { 391: B }, db: { 391: A } });
    const service = new HybridDataService(sheet as unknown as SheetService, db as unknown as DatabaseService, {
      mode: 'sheets',
    });
    await service.updateOrderStatus(391, '입금확인');
    expect(sheet.getTimestampsByRows).not.toHaveBeenCalled();
    expect(sheet.updateOrderStatus).toHaveBeenCalledTimes(1);
  });
});
