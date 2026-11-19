/**
 * 최초 입력값 · 시트 우선 가져오기 확인 (#281)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestServer, AUTH_HEADERS } from '../helpers/test-server.js';
import { MockSheetService, createMockSheetRow } from '../helpers/mock-sheet-service.js';

describe('#281 최초 입력값 · 시트 우선 가져오기', () => {
  let server: FastifyInstance;
  let mock: MockSheetService;

  beforeAll(async () => {
    const setup = await createTestServer();
    server = setup.server;
    mock = setup.mockSheetService;
  });
  beforeEach(() => mock.reset());
  afterAll(async () => {
    await server.close();
  });

  it('주문 상세는 보관된 최초 입력값을 돌려준다', async () => {
    mock.setMockAllOrders([
      createMockSheetRow({
        _rowNumber: 7,
        _originalInput: { '받으실분 성함': '처음 받는이', '추가 요청사항': '문 앞' },
      } as never),
    ]);
    const res = await server.inject({ method: 'GET', url: '/api/orders/7', headers: AUTH_HEADERS });
    expect(res.statusCode).toBe(200);
    expect(res.json().order.originalInput).toEqual({ '받으실분 성함': '처음 받는이', '추가 요청사항': '문 앞' });
  });

  it('이 기능 이전 주문은 최초 입력값이 없다(필드 없음)', async () => {
    mock.setMockAllOrders([createMockSheetRow({ _rowNumber: 8 })]);
    const res = await server.inject({ method: 'GET', url: '/api/orders/8', headers: AUTH_HEADERS });
    expect(res.statusCode).toBe(200);
    expect(res.json().order).not.toHaveProperty('originalInput');
  });

  it('주문 목록에는 최초 입력값을 싣지 않는다', async () => {
    mock.setMockAllOrders([
      createMockSheetRow({ _rowNumber: 9, _originalInput: { a: 'b' } } as never),
    ]);
    const res = await server.inject({ method: 'GET', url: '/api/orders?status=all', headers: AUTH_HEADERS });
    expect(res.statusCode).toBe(200);
    for (const o of res.json().orders ?? []) expect(o).not.toHaveProperty('originalInput');
  });

  it('시트 우선 가져오기는 확인값 없이는 실행하지 않는다(400)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/sync/full',
      headers: { ...AUTH_HEADERS, 'x-app-client': 'web', 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
