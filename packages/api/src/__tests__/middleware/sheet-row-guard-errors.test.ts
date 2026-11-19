/**
 * #258 hybrid 시트 행 확인 오류의 HTTP 응답
 * - SheetRowMismatchError → 409 · 서버 문구 그대로(행 번호 · "변경된 내용은 없습니다")
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { SheetRowMismatchError } from '@mytangerine/core';
import { errorHandler } from '../../middleware/error-handler.js';

describe('sheet row guard errors (#258)', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = Fastify({ logger: false });
    server.setErrorHandler(errorHandler);
    server.patch('/mismatch', async () => {
      throw new SheetRowMismatchError('updateOrder', [391]);
    });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it('행 불일치는 409 와 서버 문구', async () => {
    const res = await server.inject({ method: 'PATCH', url: '/mismatch' });
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.payload);
    expect(body.error).toContain('행 순서가 DB 와 맞지 않아');
    expect(body.error).toContain('변경된 내용은 없습니다');
    expect(body.error).toContain('391');
  });
});
