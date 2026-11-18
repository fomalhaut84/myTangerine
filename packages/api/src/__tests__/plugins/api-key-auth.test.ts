/**
 * 전역 API 키 인증 훅 (#218)
 */

import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import apiKeyAuth from '../../plugins/api-key-auth.js';
import { buildCorsOptions } from '../../cors-options.js';

const KEY = 'test-api-key-0123456789abcdef0123456789';

async function build(apiKey: string | undefined): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });
  await server.register(cors, buildCorsOptions('https://web.example.com'));
  await server.register(apiKeyAuth, { apiKey });
  server.get('/health', async () => ({ status: 'ok' }));
  server.get('/', async () => ({ name: 'api' }));
  server.get('/api/orders', async () => ({ success: true }));
  server.get('/docs', async () => 'docs');
  await server.ready();
  return server;
}

describe('api-key-auth plugin', () => {
  let server: FastifyInstance;

  afterEach(async () => {
    await server.close();
  });

  it('allows /health without a key', async () => {
    server = await build(KEY);
    const res = await server.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('does not treat /health with a query or a lookalike path as public only by prefix', async () => {
    server = await build(KEY);
    expect((await server.inject({ method: 'GET', url: '/health?x=1' })).statusCode).toBe(200);
    expect((await server.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(401);
  });

  it.each(['/', '/api/orders', '/docs'])('rejects %s without a key (401)', async (url) => {
    server = await build(KEY);
    const res = await server.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.payload)).toMatchObject({ success: false, statusCode: 401 });
  });

  it('rejects a wrong key (403)', async () => {
    server = await build(KEY);
    const res = await server.inject({ method: 'GET', url: '/api/orders', headers: { 'x-api-key': 'nope' } });
    expect(res.statusCode).toBe(403);
  });

  it('accepts the right key', async () => {
    server = await build(KEY);
    const res = await server.inject({ method: 'GET', url: '/api/orders', headers: { 'x-api-key': KEY } });
    expect(res.statusCode).toBe(200);
  });

  it('fails closed with 503 when the server key is not configured', async () => {
    server = await build(undefined);
    const res = await server.inject({ method: 'GET', url: '/api/orders', headers: { 'x-api-key': KEY } });
    expect(res.statusCode).toBe(503);
    // 헬스체크는 키 설정과 무관하게 열려 있어야 배포 확인이 가능하다
    expect((await server.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });

  it('lets CORS preflight through without a key', async () => {
    server = await build(KEY);
    const res = await server.inject({
      method: 'OPTIONS',
      url: '/api/orders',
      headers: { origin: 'https://web.example.com', 'access-control-request-method': 'PATCH' },
    });
    expect(res.statusCode).toBe(204);
  });

  it('does not leak the expected key or the provided key in the response', async () => {
    server = await build(KEY);
    const res = await server.inject({ method: 'GET', url: '/api/orders', headers: { 'x-api-key': 'leak-me' } });
    expect(res.payload).not.toContain(KEY);
    expect(res.payload).not.toContain('leak-me');
  });
});
