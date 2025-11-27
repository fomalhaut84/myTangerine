/**
 * 주문 API 통합 테스트
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createTestServer } from '../helpers/test-server.js';
import { MockSheetService, createMockSheetRows, createMockSheetRow } from '../helpers/mock-sheet-service.js';

describe('Orders API', () => {
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
});
