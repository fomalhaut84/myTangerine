/**
 * 에러 핸들러 미들웨어 테스트
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { errorHandler } from '../../middleware/error-handler.js';

describe('Error Handler Middleware', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = Fastify({ logger: false });
    server.setErrorHandler(errorHandler);

    // 404 에러 테스트용 라우트
    server.get('/test/404', async () => {
      const error: any = new Error('Not Found');
      error.statusCode = 404;
      throw error;
    });

    // 400 에러 테스트용 라우트
    server.get('/test/400', async () => {
      const error: any = new Error('Bad Request');
      error.statusCode = 400;
      throw error;
    });

    // 500 에러 테스트용 라우트
    server.get('/test/500', async () => {
      throw new Error('Internal Server Error');
    });

    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it('should handle 404 errors with correct message', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/test/404',
    });

    expect(response.statusCode).toBe(404);
    const payload = JSON.parse(response.payload);
    expect(payload.success).toBe(false);
    expect(payload.error).toBe('요청한 리소스를 찾을 수 없습니다.');
    expect(payload.statusCode).toBe(404);
    expect(payload).toHaveProperty('timestamp');
  });

  it('should handle 400 errors with error message', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/test/400',
    });

    expect(response.statusCode).toBe(400);
    const payload = JSON.parse(response.payload);
    expect(payload.success).toBe(false);
    expect(payload.error).toBe('Bad Request');
    expect(payload.statusCode).toBe(400);
  });

  it('should handle 500 errors without exposing internal details', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/test/500',
    });

    expect(response.statusCode).toBe(500);
    const payload = JSON.parse(response.payload);
    expect(payload.success).toBe(false);
    expect(payload.error).toBe('서버 내부 오류가 발생했습니다.');
    expect(payload.statusCode).toBe(500);
    // 내부 에러 메시지가 노출되지 않아야 함
    expect(payload.error).not.toContain('Internal Server Error');
  });

  it('should include timestamp in error response', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/test/500',
    });

    const payload = JSON.parse(response.payload);
    expect(payload.timestamp).toBeDefined();
    expect(new Date(payload.timestamp).toString()).not.toBe('Invalid Date');
  });
});
