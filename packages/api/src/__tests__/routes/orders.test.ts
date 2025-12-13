/**
 * 주문 API 통합 테스트
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createTestServer } from '../helpers/test-server.js';
import { MockSheetService, createMockSheetRows, createMockSheetRow } from '../helpers/mock-sheet-service.js';
import { clearStatsCache } from '../../routes/orders.js';

describe('Orders API', () => {
  let server: FastifyInstance;
  let mockSheetService: MockSheetService;

  beforeAll(async () => {
    const setup = await createTestServer();
    server = setup.server;
    mockSheetService = setup.mockSheetService;
  });

  beforeEach(() => {
    // 각 테스트 전에 mock 및 캐시 초기화
    mockSheetService.reset();
    clearStatsCache();
  });

  afterAll(async () => {
    await server.close();
  });

  describe('GET /api/orders', () => {
    it('should return empty order list when no orders', async () => {
      // Mock: 주문 없음
      mockSheetService.setMockNewOrders([]);

      const response = await server.inject({
        method: 'GET',
        url: '/api/orders',
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload).toHaveProperty('success', true);
      expect(payload.count).toBe(0);
      expect(payload.orders).toEqual([]);
    });

    it('should return order list with correct count', async () => {
      // Mock: 5개의 주문
      const mockOrders = createMockSheetRows(5);
      mockSheetService.setMockNewOrders(mockOrders);

      const response = await server.inject({
        method: 'GET',
        url: '/api/orders',
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload).toHaveProperty('success', true);
      expect(payload.count).toBe(5);
      expect(Array.isArray(payload.orders)).toBe(true);
      expect(payload.orders.length).toBe(5);
    });

    it('should return orders with correct structure', async () => {
      // Mock: 1개의 주문
      const mockOrders = createMockSheetRows(1);
      mockSheetService.setMockNewOrders(mockOrders);

      const response = await server.inject({
        method: 'GET',
        url: '/api/orders',
      });

      const payload = JSON.parse(response.payload);
      expect(payload.count).toBe(1);

      const order = payload.orders[0];
      expect(order).toHaveProperty('timestamp');
      expect(order).toHaveProperty('timestampRaw');
      expect(order).toHaveProperty('status');
      expect(order).toHaveProperty('sender');
      expect(order).toHaveProperty('recipient');
      expect(order).toHaveProperty('productType');
      expect(order).toHaveProperty('quantity');
      expect(order).toHaveProperty('rowNumber');

      // sender와 recipient 구조 확인
      expect(order.sender).toHaveProperty('name');
      expect(order.sender).toHaveProperty('phone');
      expect(order.sender).toHaveProperty('address');
      expect(order.recipient).toHaveProperty('name');
      expect(order.recipient).toHaveProperty('phone');
      expect(order.recipient).toHaveProperty('address');
    });

    it('should return invalid order with null productType and validationError', async () => {
      // Mock: 유효하지 않은 상품 선택을 가진 주문
      const mockOrders = [
        createMockSheetRow({
          _rowNumber: 20,
          '상품 선택': '3kg', // 유효하지 않은 타입
          '5kg 수량': '',
          '10kg 수량': '',
          _validationError: '유효하지 않은 상품 타입: "3kg"',
        }),
      ];
      mockSheetService.setMockNewOrders(mockOrders);

      const response = await server.inject({
        method: 'GET',
        url: '/api/orders',
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.success).toBe(true);
      expect(payload.count).toBe(1);
      expect(payload.orders.length).toBe(1);

      const order = payload.orders[0];
      // productType은 null이어야 함
      expect(order.productType).toBeNull();
      // validationError는 존재해야 함
      expect(order.validationError).toBe('유효하지 않은 상품 타입: "3kg"');
    });

    it('should include both valid and invalid orders in response', async () => {
      // Mock: 유효한 주문과 유효하지 않은 주문 혼합
      const mockOrders = [
        createMockSheetRow({
          _rowNumber: 10,
          '상품 선택': '5kg',
          '5kg 수량': '2',
        }),
        createMockSheetRow({
          _rowNumber: 11,
          '상품 선택': '3kg',
          _validationError: '유효하지 않은 상품 타입: "3kg"',
        }),
        createMockSheetRow({
          _rowNumber: 12,
          '상품 선택': '10kg',
          '10kg 수량': '1',
        }),
      ];
      mockSheetService.setMockNewOrders(mockOrders);

      const response = await server.inject({
        method: 'GET',
        url: '/api/orders',
      });

      const payload = JSON.parse(response.payload);
      expect(payload.count).toBe(3);

      // 첫 번째: 유효한 5kg 주문
      expect(payload.orders[0].productType).toBe('5kg');
      expect(payload.orders[0].validationError).toBeUndefined();

      // 두 번째: 유효하지 않은 주문
      expect(payload.orders[1].productType).toBeNull();
      expect(payload.orders[1].validationError).toBe('유효하지 않은 상품 타입: "3kg"');

      // 세 번째: 유효한 10kg 주문
      expect(payload.orders[2].productType).toBe('10kg');
      expect(payload.orders[2].validationError).toBeUndefined();
    });
  });

  describe('GET /api/orders/summary', () => {
    it('should return empty summary when no orders', async () => {
      // Mock: 주문 없음
      mockSheetService.setMockNewOrders([]);

      const response = await server.inject({
        method: 'GET',
        url: '/api/orders/summary',
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload).toHaveProperty('success', true);
      expect(payload).toHaveProperty('summary');

      const { summary } = payload;
      expect(summary['5kg'].count).toBe(0);
      expect(summary['5kg'].amount).toBe(0);
      expect(summary['10kg'].count).toBe(0);
      expect(summary['10kg'].amount).toBe(0);
      expect(summary.total).toBe(0);
    });

    it('should return summary with correct structure', async () => {
      // Mock: 5kg 2개, 10kg 1개
      const mockOrders = createMockSheetRows(3);
      mockSheetService.setMockNewOrders(mockOrders);

      const response = await server.inject({
        method: 'GET',
        url: '/api/orders/summary',
      });

      const payload = JSON.parse(response.payload);
      const { summary } = payload;

      expect(summary).toHaveProperty('5kg');
      expect(summary).toHaveProperty('10kg');
      expect(summary).toHaveProperty('total');

      expect(summary['5kg']).toHaveProperty('count');
      expect(summary['5kg']).toHaveProperty('amount');
      expect(summary['10kg']).toHaveProperty('count');
      expect(summary['10kg']).toHaveProperty('amount');

      expect(typeof summary['5kg'].count).toBe('number');
      expect(typeof summary['5kg'].amount).toBe('number');
      expect(typeof summary['10kg'].count).toBe('number');
      expect(typeof summary['10kg'].amount).toBe('number');
      expect(typeof summary.total).toBe('number');
    });

    it('should calculate total correctly', async () => {
      // Mock: 여러 주문
      const mockOrders = createMockSheetRows(5);
      mockSheetService.setMockNewOrders(mockOrders);

      const response = await server.inject({
        method: 'GET',
        url: '/api/orders/summary',
      });

      const payload = JSON.parse(response.payload);
      const { summary } = payload;

      const expectedTotal = summary['5kg'].amount + summary['10kg'].amount;
      expect(summary.total).toBe(expectedTotal);
      expect(summary.total).toBeGreaterThan(0);
    });
  });

  describe('POST /api/orders/confirm', () => {
    it('should return message when no orders to confirm', async () => {
      // Mock: 주문 없음
      mockSheetService.setMockNewOrders([]);

      const response = await server.inject({
        method: 'POST',
        url: '/api/orders/confirm',
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.success).toBe(true);
      expect(payload.message).toBe('확인할 새로운 주문이 없습니다.');
      expect(payload.confirmedCount).toBe(0);
    });

    it('should confirm orders and return correct count', async () => {
      // Mock: 3개의 주문
      const mockOrders = createMockSheetRows(3);
      mockSheetService.setMockNewOrders(mockOrders);

      const response = await server.inject({
        method: 'POST',
        url: '/api/orders/confirm',
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.success).toBe(true);
      expect(payload.message).toBe('3개의 주문이 확인되었습니다.');
      expect(payload.confirmedCount).toBe(3);
    });

    it('should clear orders after confirmation', async () => {
      // Mock: 5개의 주문
      const mockOrders = createMockSheetRows(5);
      mockSheetService.setMockNewOrders(mockOrders);

      // 첫 번째 확인
      const response1 = await server.inject({
        method: 'POST',
        url: '/api/orders/confirm',
      });
      expect(JSON.parse(response1.payload).confirmedCount).toBe(5);

      // 두 번째 확인 (주문이 이미 처리됨)
      const response2 = await server.inject({
        method: 'POST',
        url: '/api/orders/confirm',
      });
      const payload2 = JSON.parse(response2.payload);
      expect(payload2.confirmedCount).toBe(0);
      expect(payload2.message).toBe('확인할 새로운 주문이 없습니다.');
    });
  });

  describe('GET /api/orders/:rowNumber', () => {
    it('should return 400 error for invalid row number', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/orders/invalid',
      });

      expect(response.statusCode).toBe(400);
      const payload = JSON.parse(response.payload);
      expect(payload.success).toBe(false);
      expect(payload.error).toContain('Invalid row number');
    });

    it('should return 400 error for row number less than 2', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/orders/1',
      });

      expect(response.statusCode).toBe(400);
      const payload = JSON.parse(response.payload);
      expect(payload.success).toBe(false);
      expect(payload.error).toContain('Invalid row number');
    });

    it('should return 400 error for row number with non-numeric suffix', async () => {
      // "2foo"는 parseInt로는 2가 되지만 엄격한 검증에서는 거부되어야 함
      const response = await server.inject({
        method: 'GET',
        url: '/api/orders/2foo',
      });

      expect(response.statusCode).toBe(400);
      const payload = JSON.parse(response.payload);
      expect(payload.success).toBe(false);
      expect(payload.error).toContain('Invalid row number');
    });

    it('should return 404 error when order not found', async () => {
      // Mock: 주문 없음
      mockSheetService.setMockNewOrders([]);

      const response = await server.inject({
        method: 'GET',
        url: '/api/orders/999',
      });

      expect(response.statusCode).toBe(404);
      const payload = JSON.parse(response.payload);
      expect(payload.success).toBe(false);
      expect(payload.error).toContain('Order not found');
    });

    it('should return order with correct structure', async () => {
      // Mock: 1개의 주문 (rowNumber: 10)
      const mockOrders = createMockSheetRows(1);
      mockSheetService.setMockNewOrders(mockOrders);

      const response = await server.inject({
        method: 'GET',
        url: '/api/orders/10',
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);

      expect(payload.success).toBe(true);
      expect(payload).toHaveProperty('order');

      const order = payload.order;
      expect(order).toHaveProperty('timestamp');
      expect(order).toHaveProperty('timestampRaw');
      expect(order).toHaveProperty('status');
      expect(order).toHaveProperty('sender');
      expect(order).toHaveProperty('recipient');
      expect(order).toHaveProperty('productType');
      expect(order).toHaveProperty('quantity');
      expect(order).toHaveProperty('rowNumber');
      expect(order.rowNumber).toBe(10);
    });

    it('should find order in new orders', async () => {
      // Mock: 5개의 주문
      const mockOrders = createMockSheetRows(5);
      mockSheetService.setMockNewOrders(mockOrders);

      // rowNumber 12에 해당하는 주문 조회 (3번째 주문, 인덱스 2)
      const response = await server.inject({
        method: 'GET',
        url: '/api/orders/12',
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.success).toBe(true);
      expect(payload.order.rowNumber).toBe(12);
      expect(payload.order.recipient.name).toBe('테스트3');
    });

    it('should find order in completed orders', async () => {
      // Mock: 완료된 주문 설정
      const completedOrders = createMockSheetRows(3);
      completedOrders.forEach(order => {
        order['비고'] = '확인';
      });
      mockSheetService.setMockCompletedOrders(completedOrders);

      // rowNumber 11에 해당하는 주문 조회
      const response = await server.inject({
        method: 'GET',
        url: '/api/orders/11',
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.success).toBe(true);
      expect(payload.order.rowNumber).toBe(11);
      expect(payload.order.status).toBe('확인');
    });
  });

  describe('GET /api/orders/stats', () => {
    it('should return stats with default parameters (scope=completed, range=12m)', async () => {
      // Mock: 완료된 주문 설정
      const completedOrders = createMockSheetRows(10);
      completedOrders.forEach(order => {
        order['비고'] = '확인';
      });
      mockSheetService.setMockCompletedOrders(completedOrders);

      const response = await server.inject({
        method: 'GET',
        url: '/api/orders/stats',
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);

      // 응답 구조 검증
      expect(payload).toHaveProperty('success', true);
      expect(payload).toHaveProperty('filters');
      expect(payload).toHaveProperty('summary');
      expect(payload).toHaveProperty('series');
      expect(payload).toHaveProperty('totalsByProduct');
      expect(payload).toHaveProperty('meta');

      // filters 검증
      expect(payload.filters).toEqual({
        scope: 'completed',
        range: '12m',
        grouping: 'monthly',
        metric: 'quantity',
        orderType: 'all',
      });

      // meta 검증
      expect(payload.meta).toHaveProperty('generatedAt');
      expect(payload.meta).toHaveProperty('currency', 'KRW');
    });

    it('should return stats for new orders (scope=new)', async () => {
      // Mock: 신규 주문 설정
      const newOrders = createMockSheetRows(5);
      mockSheetService.setMockNewOrders(newOrders);

      const response = await server.inject({
        method: 'GET',
        url: '/api/orders/stats?scope=new',
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);

      expect(payload.filters.scope).toBe('new');
      expect(payload.success).toBe(true);
    });

    it('should return stats for all orders (scope=all)', async () => {
      // Mock: 모든 주문 설정
      const allOrders = createMockSheetRows(15);
      mockSheetService.setMockAllOrders(allOrders);

      const response = await server.inject({
        method: 'GET',
        url: '/api/orders/stats?scope=all',
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);

      expect(payload.filters.scope).toBe('all');
      expect(payload.success).toBe(true);
    });

    it('should return stats with 6 month range (range=6m)', async () => {
      // Mock: 완료된 주문 설정
      const completedOrders = createMockSheetRows(8);
      completedOrders.forEach(order => {
        order['비고'] = '확인';
      });
      mockSheetService.setMockCompletedOrders(completedOrders);

      const response = await server.inject({
        method: 'GET',
        url: '/api/orders/stats?range=6m',
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);

      expect(payload.filters.range).toBe('6m');
      expect(payload.success).toBe(true);
    });

    it('should return 400 error when range=custom but start/end not provided', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/orders/stats?range=custom',
      });

      expect(response.statusCode).toBe(400);
      const payload = JSON.parse(response.payload);

      expect(payload.success).toBe(false);
      expect(payload.error).toContain('start and end dates are required');
    });

    it('should return 400 error when date format is invalid', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/orders/stats?range=custom&start=invalid&end=2025-12-31',
      });

      expect(response.statusCode).toBe(400);
      const payload = JSON.parse(response.payload);

      expect(payload.success).toBe(false);
      // Fastify의 schema validation이 먼저 실행되어 format 에러 반환
      expect(payload.error).toContain('must match format');
    });

    it('should return 400 error when start date is after end date', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/orders/stats?range=custom&start=2025-12-31&end=2025-01-01',
      });

      expect(response.statusCode).toBe(400);
      const payload = JSON.parse(response.payload);

      expect(payload.success).toBe(false);
      expect(payload.error).toContain('start date must be before or equal to end date');
    });

    it('should return stats with custom date range', async () => {
      // Mock: 완료된 주문 설정
      const completedOrders = createMockSheetRows(6);
      completedOrders.forEach(order => {
        order['비고'] = '확인';
      });
      mockSheetService.setMockCompletedOrders(completedOrders);

      const response = await server.inject({
        method: 'GET',
        url: '/api/orders/stats?range=custom&start=2025-01-01&end=2025-12-31',
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);

      expect(payload.filters.range).toBe('custom');
      expect(payload.summary.dateRange).toHaveProperty('start');
      expect(payload.summary.dateRange).toHaveProperty('end');
    });

    it('should return correct summary structure', async () => {
      // Mock: 완료된 주문 설정
      const completedOrders = createMockSheetRows(10);
      completedOrders.forEach(order => {
        order['비고'] = '확인';
      });
      mockSheetService.setMockCompletedOrders(completedOrders);

      const response = await server.inject({
        method: 'GET',
        url: '/api/orders/stats',
      });

      const payload = JSON.parse(response.payload);
      const { summary } = payload;

      expect(summary).toHaveProperty('total5kgQty');
      expect(summary).toHaveProperty('total10kgQty');
      expect(summary).toHaveProperty('total5kgAmount');
      expect(summary).toHaveProperty('total10kgAmount');
      expect(summary).toHaveProperty('totalRevenue');
      expect(summary).toHaveProperty('avgOrderAmount');
      expect(summary).toHaveProperty('dateRange');

      expect(typeof summary.total5kgQty).toBe('number');
      expect(typeof summary.total10kgQty).toBe('number');
      expect(typeof summary.total5kgAmount).toBe('number');
      expect(typeof summary.total10kgAmount).toBe('number');
      expect(typeof summary.totalRevenue).toBe('number');
      expect(typeof summary.avgOrderAmount).toBe('number');
    });

    it('should return series array with correct structure', async () => {
      // Mock: 완료된 주문 설정
      const completedOrders = createMockSheetRows(10);
      completedOrders.forEach(order => {
        order['비고'] = '확인';
      });
      mockSheetService.setMockCompletedOrders(completedOrders);

      const response = await server.inject({
        method: 'GET',
        url: '/api/orders/stats',
      });

      const payload = JSON.parse(response.payload);
      const { series } = payload;

      expect(Array.isArray(series)).toBe(true);

      if (series.length > 0) {
        const firstEntry = series[0];
        expect(firstEntry).toHaveProperty('period');
        expect(firstEntry).toHaveProperty('total5kgQty');
        expect(firstEntry).toHaveProperty('total10kgQty');
        expect(firstEntry).toHaveProperty('total5kgAmount');
        expect(firstEntry).toHaveProperty('total10kgAmount');
        expect(firstEntry).toHaveProperty('orderCount');
        expect(firstEntry).toHaveProperty('avgOrderAmount');
        expect(firstEntry).toHaveProperty('momGrowthPct');
      }
    });

    it('should return totalsByProduct array with correct structure', async () => {
      // Mock: 완료된 주문 설정
      const completedOrders = createMockSheetRows(10);
      completedOrders.forEach(order => {
        order['비고'] = '확인';
      });
      mockSheetService.setMockCompletedOrders(completedOrders);

      const response = await server.inject({
        method: 'GET',
        url: '/api/orders/stats',
      });

      const payload = JSON.parse(response.payload);
      const { totalsByProduct } = payload;

      expect(Array.isArray(totalsByProduct)).toBe(true);

      if (totalsByProduct.length > 0) {
        const firstProduct = totalsByProduct[0];
        expect(firstProduct).toHaveProperty('productType');
        expect(firstProduct).toHaveProperty('quantity');
        expect(firstProduct).toHaveProperty('amount');
        expect(firstProduct).toHaveProperty('quantityPct');
        expect(firstProduct).toHaveProperty('revenuePct');

        expect(['5kg', '10kg']).toContain(firstProduct.productType);
      }
    });

    it('should return empty stats when no orders', async () => {
      // Mock: 주문 없음
      mockSheetService.setMockCompletedOrders([]);

      const response = await server.inject({
        method: 'GET',
        url: '/api/orders/stats',
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);

      expect(payload.success).toBe(true);
      expect(payload.summary.total5kgQty).toBe(0);
      expect(payload.summary.total10kgQty).toBe(0);
      expect(payload.summary.totalRevenue).toBe(0);
      expect(payload.series).toEqual([]);
      expect(payload.totalsByProduct).toEqual([]);
    });
  });
});
