/**
 * 동기화 응답 (#279)
 *
 * SyncResult 의 충돌 · 행 정체성 정지(#257 · #260) · 행 밀림 정지(#261) 가 응답 스키마에 없어
 * Fastify 직렬화에서 사라졌다. 수동 동기화는 #hermes 경고를 보내지 않으므로 화면이 유일한 신호다.
 */

import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { buildSyncResponse, syncResponseSchema, type SyncRouteResult } from '../../routes/sync-response.js';

function result(overrides: Partial<SyncRouteResult> = {}): SyncRouteResult {
  return {
    total: 10,
    success: 8,
    failed: 0,
    skipped: 2,
    conflicts: 0,
    errors: [],
    conflictDetails: [],
    newOrderNotices: 0,
    replaced: 0,
    replacementLimitHit: false,
    identityConflictRows: [],
    rowShiftDetected: false,
    unprocessed: 0,
    ...overrides,
  };
}

let server: FastifyInstance | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

/** 실제 라우트와 같은 응답 스키마로 직렬화를 거친다 */
async function serialize(body: unknown, full = false) {
  server = Fastify({ logger: false });
  server.get('/t', { schema: { response: { 200: syncResponseSchema(full) } } }, async () => body);
  const res = await server.inject({ method: 'GET', url: '/t' });
  return res.json();
}

describe('buildSyncResponse', () => {
  it('정상: 성공 · 실패 · 건너뜀 메시지 · 경고 없음', () => {
    const body = buildSyncResponse(result(), 'incremental');
    expect(body.success).toBe(true);
    expect(body.message).toBe('동기화 완료: 8개 성공, 0개 실패, 2개 건너뜀');
    expect(body.warning).toBe(false);
  });

  it('행 오류 사유는 일반화한다(내부 상세 노출 방지)', () => {
    const body = buildSyncResponse(result({ failed: 1, errors: [{ rowNumber: 5, error: 'DB upsert failed: secret detail' }] }), 'incremental');
    expect(body.result.errors).toEqual([{ rowNumber: 5, error: 'Sync failed for this row' }]);
  });

  it('충돌 상세는 행 번호 · 주문 id 만 — 사유 문자열(내부 시각)은 뺀다', () => {
    const body = buildSyncResponse(
      result({ conflicts: 1, conflictDetails: [{ rowNumber: 7, orderId: 70, reason: 'DB modified at 2026-11-19T01:00:00.000Z > ...' }] }),
      'incremental'
    );
    expect(body.result.conflictDetails).toEqual([{ rowNumber: 7, orderId: 70 }]);
    expect(body.message).toContain('충돌 1건');
    expect(body.warning).toBe(true);
  });

  it('행 밀림 정지(#261) — 메시지에 정지 · 남은 행 · 런북 안내, 경고', () => {
    const body = buildSyncResponse(
      result({ failed: 10, rowShiftDetected: true, unprocessed: 30, identityConflictRows: [11, 12] }),
      'full',
      42
    );
    expect(body.warning).toBe(true);
    expect(body.message).toContain('전체 동기화');
    expect(body.message).toContain('시트 행 순서가 바뀌어 동기화를 멈췄습니다');
    expect(body.message).toContain('남은 30행');
    expect(body.message).toContain('소요 시간: 42초');
    expect(body.result.duration).toBe(42);
  });

  it('행 정체성 정지(#257 · #260)만 있으면 정지 행 수를 알린다', () => {
    const body = buildSyncResponse(result({ failed: 2, identityConflictRows: [391, 392] }), 'incremental');
    expect(body.warning).toBe(true);
    expect(body.message).toContain('행 2개는 시트와 DB 주문이 맞지 않아 쓰지 않았습니다');
  });
});

describe('syncResponseSchema — 직렬화 뒤에도 필드가 남는다', () => {
  it('충돌 · 정지 · 교체 · 알림 필드가 응답에 남는다', async () => {
    const body = buildSyncResponse(
      result({
        conflicts: 1,
        conflictDetails: [{ rowNumber: 7, orderId: 70, reason: 'x' }],
        replaced: 1,
        replacementLimitHit: true,
        newOrderNotices: 2,
        identityConflictRows: [11, 12],
        rowShiftDetected: true,
        unprocessed: 5,
      }),
      'incremental'
    );
    const json = await serialize(body);
    expect(json.warning).toBe(true);
    expect(json.result).toMatchObject({
      conflicts: 1,
      conflictDetails: [{ rowNumber: 7, orderId: 70 }],
      replaced: 1,
      replacementLimitHit: true,
      newOrderNotices: 2,
      identityConflictRows: [11, 12],
      rowShiftDetected: true,
      unprocessed: 5,
    });
    expect(json.result.conflictDetails[0]).not.toHaveProperty('reason');
  });

  it('전체 동기화 스키마는 duration 을 남긴다', async () => {
    const json = await serialize(buildSyncResponse(result(), 'full', 12), true);
    expect(json.result.duration).toBe(12);
  });

  it('#281: 기존 주문 유지 수 · 시트와 다른 행이 응답 · 메시지에 남는다', async () => {
    const body = buildSyncResponse(result({ success: 1, unchanged: 3, sheetDivergedRows: [12] }), 'incremental');
    expect(body.message).toContain('기존 주문 유지 3개');
    expect(body.message).toContain('행 1개는 시트 값이 DB 와 달라 DB 값을 유지했습니다');
    const json = await serialize(body);
    expect(json.result).toMatchObject({ unchanged: 3, sheetDivergedRows: [12] });
  });

  it('core dist 가 낡아 새 필드가 없어도(undefined) 기본값으로 응답한다', async () => {
    const legacy = { total: 1, success: 1, failed: 0, skipped: 0, errors: [] } as unknown as SyncRouteResult;
    const body = buildSyncResponse(legacy, 'incremental');
    const json = await serialize(body);
    expect(json.warning).toBe(false);
    expect(json.result).toMatchObject({ conflicts: 0, identityConflictRows: [], rowShiftDetected: false, unprocessed: 0 });
  });
});
