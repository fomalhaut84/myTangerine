/**
 * 라벨 API 통합 테스트
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createTestServer } from '../helpers/test-server.js';
import { MockSheetService, createMockSheetRows } from '../helpers/mock-sheet-service.js';

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
        method: 'GET',
        url: '/api/labels',
      });

      expect(response.statusCode).toBe(200);
      const labels = response.payload;

      // 라벨 포맷 확인
      expect(labels).toContain('보내는사람');
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
        method: 'GET',
        url: '/api/labels',
      });

      const labels = response.payload;

      // 상품 정보 포함 확인
      expect(labels).toMatch(/5kg|10kg/);
      expect(labels).toContain('박스');
    });
  });
});
