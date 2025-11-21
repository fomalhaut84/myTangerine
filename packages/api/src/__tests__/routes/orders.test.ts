/**
 * 주문 API 통합 테스트
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../../index.js';
import { Env } from '../../config.js';

// TODO: SheetService mock 추가 후 활성화
describe.skip('Orders API', () => {
  let server: FastifyInstance;

  const testEnv: Env = {
    PORT: 3001,
    HOST: '127.0.0.1',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    CORS_ORIGIN: '*',
  };

  beforeAll(async () => {
    // 테스트용 환경 변수 설정
    process.env.DEFAULT_SENDER_NAME = 'Test Sender';
    process.env.DEFAULT_SENDER_PHONE = '010-1234-5678';
    process.env.DEFAULT_SENDER_ADDRESS = 'Test Address';
    process.env.SPREADSHEET_ID = 'test-sheet-id';
    process.env.GOOGLE_CREDENTIALS_JSON = JSON.stringify({
      type: 'service_account',
      project_id: 'test-project',
      private_key_id: 'test-key-id',
      private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n',
      client_email: 'test@test.iam.gserviceaccount.com',
      client_id: 'test',
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
    });

    server = await createServer(testEnv);
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  describe('GET /api/orders', () => {
    it('should return order list with 200 status', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/orders',
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload).toHaveProperty('success', true);
      expect(payload).toHaveProperty('count');
      expect(payload).toHaveProperty('orders');
      expect(Array.isArray(payload.orders)).toBe(true);
    });

    it('should return orders with correct structure', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/orders',
      });

      const payload = JSON.parse(response.payload);

      if (payload.count > 0) {
        const order = payload.orders[0];
        expect(order).toHaveProperty('timestamp');
        expect(order).toHaveProperty('timestampRaw');
        expect(order).toHaveProperty('status');
        expect(order).toHaveProperty('sender');
        expect(order).toHaveProperty('recipient');
        expect(order).toHaveProperty('productType');
        expect(order).toHaveProperty('quantity');
        expect(order).toHaveProperty('rowNumber');
      }
    });
  });

  describe('GET /api/orders/summary', () => {
    it('should return summary with 200 status', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/orders/summary',
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload).toHaveProperty('success', true);
      expect(payload).toHaveProperty('summary');
    });

    it('should return summary with correct structure', async () => {
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
      const response = await server.inject({
        method: 'GET',
        url: '/api/orders/summary',
      });

      const payload = JSON.parse(response.payload);
      const { summary } = payload;

      const expectedTotal = summary['5kg'].amount + summary['10kg'].amount;
      expect(summary.total).toBe(expectedTotal);
    });
  });

  describe('POST /api/orders/confirm', () => {
    it('should return success response', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/orders/confirm',
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload).toHaveProperty('success', true);
      expect(payload).toHaveProperty('message');
      expect(payload).toHaveProperty('confirmedCount');
      expect(typeof payload.confirmedCount).toBe('number');
    });
  });
});
