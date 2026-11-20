/**
 * DB 전용 주문 조회 실패 응답 (#229)
 *
 * hybrid · database 의 getOrderById 는 DB 만 읽는다(시트 행이 없는 배송사고 주문 — 시트 폴백 불가).
 * DB 가 실패하면 원인 불명 500 대신 일반 문구의 503 으로 답하게 HybridReadError 로 감싼다.
 * 이미 상태 코드가 있는 오류(예: DB 미설정 503)는 그대로 둔다. DatabaseService 는 mock(S-4).
 */
import { describe, it, expect, vi } from 'vitest';
import { HybridDataService } from '../hybrid-data-service.js';
import { HybridReadError, DB_READ_FAILED_MESSAGE } from '../hybrid-write.js';
import type { DatabaseService } from '../database-service.js';
import type { SheetService } from '../sheet-service.js';

function service(getOrderById: ReturnType<typeof vi.fn>, mode: 'hybrid' | 'database' = 'hybrid') {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const db = { getOrderById } as unknown as DatabaseService;
  const s = new HybridDataService({} as SheetService, db, { mode, logger });
  return { s, logger };
}

describe('HybridDataService.getOrderById — DB 실패는 503 (#229)', () => {
  it.each(['hybrid', 'database'] as const)('%s: DB 오류를 HybridReadError(503 · 일반 문구)로 감싸고 원인은 로그에만', async (mode) => {
    const { s, logger } = service(vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:5432')), mode);
    const error = await s.getOrderById(7).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HybridReadError);
    expect((error as HybridReadError).statusCode).toBe(503);
    expect((error as HybridReadError).publicMessage).toBe(DB_READ_FAILED_MESSAGE);
    expect((error as HybridReadError).publicMessage).not.toContain('ECONNREFUSED');
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
  });

  it('이미 5xx 상태 코드가 있는 오류는 그대로 던진다(방어용)', async () => {
    const configured = Object.assign(new Error('Database is not configured'), { statusCode: 503, publicMessage: 'DB 미설정' });
    const { s } = service(vi.fn().mockRejectedValue(configured));
    await expect(s.getOrderById(7)).rejects.toBe(configured);
  });

  it('4xx 상태 코드를 가진 오류는 감싼다 — 원문이 응답에 나가지 않게', async () => {
    const conflict = Object.assign(new Error('internal detail'), { statusCode: 409 });
    const { s } = service(vi.fn().mockRejectedValue(conflict));
    await expect(s.getOrderById(7)).rejects.toBeInstanceOf(HybridReadError);
  });

  it('Error 가 아닌 값으로 실패해도 503 으로 감싼다', async () => {
    const { s } = service(vi.fn().mockRejectedValue(null));
    await expect(s.getOrderById(7)).rejects.toBeInstanceOf(HybridReadError);
  });

  it('없으면 null · 있으면 그 행', async () => {
    expect(await service(vi.fn().mockResolvedValue(null)).s.getOrderById(7)).toBeNull();
    const row = { _rowNumber: 0 };
    expect(await service(vi.fn().mockResolvedValue(row)).s.getOrderById(7)).toBe(row);
  });
});
