/**
 * Prisma 플러그인 — 모드별 기동 (#245)
 *
 * sheets 모드는 DATABASE_URL 없이도 기동하고, DB 를 쓰는 경로는 503 으로 답한다.
 * database · hybrid 모드는 URL 이 없으면 기동하지 않는다(엉뚱한 DB 에 붙지 않게).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const { createPrismaClientMock } = vi.hoisted(() => ({
  createPrismaClientMock: vi.fn(),
}));

vi.mock('@mytangerine/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mytangerine/core')>();
  return { ...actual, createPrismaClient: createPrismaClientMock };
});

import prismaPlugin, { DatabaseNotConfiguredError } from '../../plugins/prisma.js';
import { errorHandler } from '../../middleware/error-handler.js';

const URL = 'postgresql://user:pw@localhost:5432/db';

async function build(options: { dataSource?: 'sheets' | 'database' | 'hybrid'; databaseUrl?: string }) {
  const server = Fastify({ logger: false });
  await server.register(prismaPlugin, options);
  server.setErrorHandler(errorHandler);
  server.get('/db-count', async () => ({ count: await server.prisma.order.count() }));
  server.get('/sheets-only', async () => ({ ok: true }));
  await server.ready();
  return server;
}

describe('prisma plugin', () => {
  let server: FastifyInstance | undefined;
  const savedUrl = process.env.DATABASE_URL;
  const savedMode = process.env.DATA_SOURCE;

  beforeEach(() => {
    createPrismaClientMock.mockReset();
    createPrismaClientMock.mockImplementation(() => {
      throw new Error('DATABASE_URL is not set');
    });
    delete process.env.DATABASE_URL;
    delete process.env.DATA_SOURCE;
  });

  afterEach(async () => {
    await server?.close();
    server = undefined;
    if (savedUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedUrl;
    if (savedMode === undefined) delete process.env.DATA_SOURCE;
    else process.env.DATA_SOURCE = savedMode;
  });

  describe('sheets 모드 + DATABASE_URL 없음', () => {
    it('기동하고 DB 와 무관한 라우트는 정상 응답한다', async () => {
      server = await build({ dataSource: 'sheets' });
      const res = await server.inject({ method: 'GET', url: '/sheets-only' });
      expect(res.statusCode).toBe(200);
      expect(createPrismaClientMock).not.toHaveBeenCalled();
    });

    it('DB 를 쓰는 라우트는 503 과 "DB 미설정" 문구로 답한다', async () => {
      server = await build({ dataSource: 'sheets' });
      const res = await server.inject({ method: 'GET', url: '/db-count' });
      expect(res.statusCode).toBe(503);
      const body = JSON.parse(res.payload);
      expect(body).toMatchObject({ success: false, statusCode: 503 });
      expect(body.error).toContain('데이터베이스가 설정되지 않았습니다');
    });

    it('DATA_SOURCE 가 없으면 기본값 sheets 로 본다', async () => {
      server = await build({});
      const res = await server.inject({ method: 'GET', url: '/db-count' });
      expect(res.statusCode).toBe(503);
    });

    it('빈 문자열 DATABASE_URL 도 미설정으로 본다', async () => {
      process.env.DATABASE_URL = '';
      server = await build({ dataSource: 'sheets' });
      expect(createPrismaClientMock).not.toHaveBeenCalled();
    });

    it('대체 객체는 Promise 로 오인되지 않고 종료 시 $disconnect 가 조용히 끝난다', async () => {
      server = await build({ dataSource: 'sheets' });
      expect((server.prisma as unknown as { then?: unknown }).then).toBeUndefined();
      await expect(server.prisma.$disconnect()).resolves.toBeUndefined();
      expect(() => server!.prisma.order).toThrow(DatabaseNotConfiguredError);
      expect(() => server!.prisma.orderChangeLog).toThrow(DatabaseNotConfiguredError);
      expect(() => server!.prisma.$transaction).toThrow(DatabaseNotConfiguredError);
    });

    it('DB 를 쓰는 서비스는 만들 때가 아니라 쓸 때 실패한다 (core 플러그인 생성자 경로)', async () => {
      server = await build({ dataSource: 'sheets' });
      const { ChangeLogService } = await import('@mytangerine/core');
      const changeLog = new ChangeLogService(server.prisma);
      await expect(changeLog.getChangeLogs(1)).rejects.toBeInstanceOf(DatabaseNotConfiguredError);
    });

    describe('자체 catch 가 있는 동기화 라우트도 500 이 아니라 503 으로 답한다', () => {
      const SYNC_KEY = 'sync-test-key-0123456789abcdef0123456789';
      const savedKey = process.env.API_SECRET_KEY;

      async function buildWithSync() {
        process.env.API_SECRET_KEY = SYNC_KEY;
        const { default: syncRoutes } = await import('../../routes/sync.js');
        const s = Fastify({ logger: false });
        await s.register(prismaPlugin, { dataSource: 'sheets' });
        s.decorate('core', {
          sheetService: { getAllRows: vi.fn().mockResolvedValue([]) },
          databaseService: {},
          dataSourceMode: 'sheets',
        } as never);
        s.setErrorHandler(errorHandler);
        await s.register(syncRoutes);
        await s.ready();
        return s;
      }

      afterEach(() => {
        if (savedKey === undefined) delete process.env.API_SECRET_KEY;
        else process.env.API_SECRET_KEY = savedKey;
      });

      it.each([
        ['GET', '/api/sync/status', undefined],
        ['POST', '/api/sync', undefined],
        // #281: 시트 우선 가져오기는 확인값이 있어야 핸들러까지 간다
        ['POST', '/api/sync/full', { confirm: 'sheet-first' }],
      ] as const)('%s %s → 503', async (method, url, payload) => {
        server = await buildWithSync();
        const res = await server.inject({
          method,
          url,
          headers: { 'x-api-key': SYNC_KEY, 'x-app-client': 'web' },
          ...(payload ? { payload } : {}),
        });
        expect(res.statusCode).toBe(503);
        expect(JSON.parse(res.payload).error).toContain('데이터베이스가 설정되지 않았습니다');
      });
    });
  });

  describe.each(['database', 'hybrid'] as const)('%s 모드 + DATABASE_URL 없음', (mode) => {
    it('기동하지 않는다 (fail-fast 유지)', async () => {
      await expect(build({ dataSource: mode })).rejects.toThrow('DATABASE_URL is not set');
      expect(createPrismaClientMock).toHaveBeenCalledTimes(1);
    });
  });

  it('DATABASE_URL 이 있으면 모드와 상관없이 실제 client 를 만든다', async () => {
    const fakeClient = { $disconnect: vi.fn().mockResolvedValue(undefined) };
    createPrismaClientMock.mockReset();
    createPrismaClientMock.mockReturnValue(fakeClient);
    process.env.DATABASE_URL = URL;
    server = await build({ dataSource: 'sheets' });
    expect(createPrismaClientMock).toHaveBeenCalledTimes(1);
    expect(server.prisma).toBe(fakeClient);
    await server.close();
    server = undefined;
    expect(fakeClient.$disconnect).toHaveBeenCalledTimes(1);
  });

  it('DATA_SOURCE 환경변수를 모드로 쓴다', async () => {
    process.env.DATA_SOURCE = 'hybrid';
    await expect(build({})).rejects.toThrow('DATABASE_URL is not set');
  });
});
