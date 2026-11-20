/**
 * DB 전용 주문 조회 실패 → 503 (#229)
 *
 * idType=dbId 경로(시트 행이 없는 배송사고 주문)는 DB 만 읽는다. DB 오류는 core 가 HybridReadError 로 감싸고
 * 전역 에러 핸들러가 일반 문구의 503 으로 답한다 — 원인(접속 주소 · 오류 원문)은 응답에 나가지 않는다.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { HybridReadError } from '@mytangerine/core';
import { createTestServer, AUTH_HEADERS } from '../helpers/test-server.js';
import type { MockSheetService } from '../helpers/mock-sheet-service.js';

describe('idType=dbId 조회 DB 실패 (#229)', () => {
  let server: FastifyInstance;
  let mock: MockSheetService;

  beforeAll(async () => {
    const setup = await createTestServer();
    server = setup.server;
    mock = setup.mockSheetService;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mock.reset();
  });

  afterAll(async () => {
    await server.close();
  });

  function failDbRead() {
    vi.spyOn(mock, 'getOrderById').mockRejectedValue(
      new HybridReadError('getOrderById', new Error('connect ECONNREFUSED 10.0.0.5:5432'))
    );
  }

  it('GET /api/orders/:id?idType=dbId — 503 · 일반 문구 · 원인 숨김', async () => {
    failDbRead();
    const res = await server.inject({ method: 'GET', url: '/api/orders/7?idType=dbId', headers: AUTH_HEADERS });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('주문을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    expect(res.payload).not.toContain('ECONNREFUSED');
  });

  it('POST /api/orders/:id/mark-delivered?idType=dbId — 503 · 아무것도 쓰지 않는다', async () => {
    failDbRead();
    const res = await server.inject({
      method: 'POST',
      url: '/api/orders/7/mark-delivered?idType=dbId',
      headers: AUTH_HEADERS,
      payload: { trackingNumber: 'T-1' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.payload).not.toContain('ECONNREFUSED');
    expect(mock.getDeliveredCalls()).toEqual([]);
  });
});
