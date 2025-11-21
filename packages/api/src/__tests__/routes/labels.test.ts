/**
 * 라벨 API 통합 테스트
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../../index.js';
import { Env } from '../../config.js';

// TODO: SheetService mock 추가 후 활성화
describe.skip('Labels API', () => {
  let server: FastifyInstance;

  const testEnv: Env = {
    PORT: 3002,
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

  describe('GET /api/labels', () => {
    it('should return text/plain content-type', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/labels',
      });

      expect(response.headers['content-type']).toContain('text/plain');
    });

    it('should return 200 status', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/labels',
      });

      expect(response.statusCode).toBe(200);
    });

    it('should return string payload', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/labels',
      });

      expect(typeof response.payload).toBe('string');
    });

    it('should handle no orders gracefully', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/labels',
      });

      // 새로운 주문이 없을 경우
      if (response.payload === '새로운 주문이 없습니다.') {
        expect(response.payload).toBe('새로운 주문이 없습니다.');
      } else {
        // 주문이 있을 경우 라벨 포맷 확인
        expect(response.payload.length).toBeGreaterThan(0);
      }
    });
  });
});
