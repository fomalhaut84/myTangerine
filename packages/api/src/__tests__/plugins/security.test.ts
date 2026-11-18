/**
 * 요청 빈도 상한 + 인증 조합 (#218)
 */

import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerSecurity } from '../../plugins/security.js';
import { errorHandler } from '../../middleware/error-handler.js';

const KEY = 'test-api-key-0123456789abcdef0123456789';
const AUTH = { 'x-api-key': KEY };

async function build(rateLimitMax: number): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });
  server.setErrorHandler(errorHandler);
  await registerSecurity(server, { apiKey: KEY, rateLimitMax });
  server.get('/health', async () => ({ status: 'ok' }));
  server.get('/api/orders', async () => ({ success: true }));
  await server.ready();
  return server;
}

describe('registerSecurity', () => {
  let server: FastifyInstance;

  afterEach(async () => {
    await server.close();
  });

  it('returns 429 once the per-window limit is exceeded', async () => {
    server = await build(2);
    expect((await server.inject({ method: 'GET', url: '/api/orders', headers: AUTH })).statusCode).toBe(200);
    expect((await server.inject({ method: 'GET', url: '/api/orders', headers: AUTH })).statusCode).toBe(200);
    const limited = await server.inject({ method: 'GET', url: '/api/orders', headers: AUTH });
    expect(limited.statusCode).toBe(429);
    expect(JSON.parse(limited.payload)).toMatchObject({ success: false, statusCode: 429 });
  });

  it('counts unauthenticated requests toward the limit', async () => {
    server = await build(1);
    expect((await server.inject({ method: 'GET', url: '/api/orders' })).statusCode).toBe(401);
    expect((await server.inject({ method: 'GET', url: '/api/orders' })).statusCode).toBe(429);
  });

  it('counts requests to unknown paths too', async () => {
    server = await build(1);
    expect((await server.inject({ method: 'GET', url: '/nope', headers: AUTH })).statusCode).toBe(404);
    expect((await server.inject({ method: 'GET', url: '/api/orders', headers: AUTH })).statusCode).toBe(429);
  });

  it('exempts /health from both the limit and the key', async () => {
    server = await build(1);
    for (let i = 0; i < 3; i += 1) {
      expect((await server.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    }
  });
});
