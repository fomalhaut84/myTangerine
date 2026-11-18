/**
 * 라벨 API 통합 테스트
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createTestServer, AUTH_HEADERS } from '../helpers/test-server.js';
import { MockSheetService, createMockSheetRows, createMockSheetRow } from '../helpers/mock-sheet-service.js';

describe('Labels API', () => {
  let server: FastifyInstance;
  let mockSheetService: MockSheetService;

  beforeAll(async () => {
    const setup = await createTestServer();
    server = setup.server;
    mockSheetService = setup.mockSheetService;
  });

  beforeEach(() => {
    // 각 테스트 전에 mock 초기화
    mockSheetService.reset();
  });

  afterAll(async () => {
    await server.close();
  });

  describe('GET /api/labels', () => {
    it('should return message when no orders', async () => {
      // Mock: 주문 없음
      mockSheetService.setMockNewOrders([]);

      const response = await server.inject({
        headers: AUTH_HEADERS,
        method: 'GET',
        url: '/api/labels',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/plain');
      expect(response.payload).toBe('새로운 주문이 없습니다.');
    });

    it('should return text/plain content-type with orders', async () => {
      // Mock: 1개의 주문
      const mockOrders = createMockSheetRows(1);
      mockSheetService.setMockNewOrders(mockOrders);

      const response = await server.inject({
        headers: AUTH_HEADERS,
        method: 'GET',
        url: '/api/labels',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/plain');
      expect(typeof response.payload).toBe('string');
      expect(response.payload.length).toBeGreaterThan(0);
    });

    it('should format labels with correct structure', async () => {
      // Mock: 여러 주문
      const mockOrders = createMockSheetRows(3);
      mockSheetService.setMockNewOrders(mockOrders);

      const response = await server.inject({
        headers: AUTH_HEADERS,
        method: 'GET',
        url: '/api/labels',
      });

      expect(response.statusCode).toBe(200);
      const labels = response.payload;

      // 라벨 포맷 확인 (보내는분 정보 표시)
      expect(labels).toContain('보내는분');
      expect(labels).toContain('받는사람');
      expect(labels).toContain('주문상품');
      // 날짜 구분선 확인
      expect(labels).toContain('====================');
    });

    it('should include product quantities in labels', async () => {
      // Mock: 5kg와 10kg 주문
      const mockOrders = createMockSheetRows(2);
      mockSheetService.setMockNewOrders(mockOrders);

      const response = await server.inject({
        headers: AUTH_HEADERS,
        method: 'GET',
        url: '/api/labels',
      });

      const labels = response.payload;

      // 상품 정보 포함 확인
      expect(labels).toMatch(/5kg|10kg/);
      expect(labels).toContain('박스');
    });
  });

  describe('GET /api/labels/grouped idType (#199)', () => {
    // 회귀: #199 — 시트에 있는 claim 은 rowNumber, DB 전용 claim 은 dbId 로 내려가야 라벨 페이지 일괄 배송완료가 가드를 통과한다
    it('returns rowNumber for a sheet claim and dbId for a DB-only claim', async () => {
      mockSheetService.setMockAllOrders([
        createMockSheetRow({ _rowNumber: 391, '비고': '입금확인', '주문유형': '배송사고', _dbId: 1487 }),
        createMockSheetRow({ _rowNumber: undefined, '비고': '입금확인', '주문유형': '배송사고', _dbId: 1500 }),
      ]);

      const response = await server.inject({
        headers: AUTH_HEADERS, method: 'GET', url: '/api/labels/grouped?status=all' });

      expect(response.statusCode).toBe(200);
      const { data } = JSON.parse(response.payload);
      const orders = data.flatMap((group: { orders: Array<{ dbId: number; idType: string }> }) => group.orders);
      const byDbId = Object.fromEntries(orders.map((o: { dbId: number; idType: string }) => [o.dbId, o.idType]));
      expect(byDbId[1487]).toBe('rowNumber');
      expect(byDbId[1500]).toBe('dbId');
    });
  });
});
