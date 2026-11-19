/**
 * Prisma 플러그인
 * PrismaClient를 Fastify 데코레이터로 등록
 *
 * Issue #68 Phase 2.1 · #245 sheets 모드는 DATABASE_URL 없이도 기동
 */

import { Prisma, type PrismaClient } from '@prisma/client';
import { createPrismaClient } from '@mytangerine/core';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { resolveDataSourceMode, type DataSourceModeName } from './data-source-mode.js';

/**
 * sheets 모드에서 DB 가 설정되지 않았는데 DB 를 쓰려 할 때 던진다.
 * 전역 에러 핸들러가 statusCode · publicMessage 로 503 응답을 만든다.
 */
export class DatabaseNotConfiguredError extends Error {
  readonly statusCode = 503;
  readonly publicMessage = '데이터베이스가 설정되지 않았습니다 (DATA_SOURCE=sheets · DATABASE_URL 없음).';

  constructor(member: string) {
    super(`Database is not configured (DATA_SOURCE=sheets, no DATABASE_URL) — accessed prisma.${member}`);
    this.name = 'DatabaseNotConfiguredError';
  }
}

/** Prisma client 의 모델 위임자 이름(order · syncLog …) — 스키마에서 나온 목록 */
const MODEL_DELEGATES: ReadonlySet<string> = new Set(
  Object.values(Prisma.ModelName).map((name) => name.charAt(0).toLowerCase() + name.slice(1))
);

function isPrismaMember(prop: string): boolean {
  return prop.startsWith('$') || MODEL_DELEGATES.has(prop);
}

/**
 * DB 미설정용 대체 client.
 * - 모델 위임자(`order` …)나 `$` 메서드에 접근하는 순간 DatabaseNotConfiguredError
 * - `$disconnect` 는 종료 훅에서 불리므로 조용히 끝난다
 * - 그 밖의 속성(`then` · fastify decorate 가 보는 `getter` 등)은 undefined —
 *   thenable 이나 접근자 정의로 오인되지 않게
 */
export function createUnconfiguredPrismaClient(): PrismaClient {
  const disconnect = async (): Promise<void> => undefined;
  return new Proxy(Object.freeze({}), {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop === '$disconnect') return disconnect;
      if (isPrismaMember(prop)) throw new DatabaseNotConfiguredError(prop);
      return undefined;
    },
  }) as unknown as PrismaClient;
}

export interface PrismaPluginOptions {
  dataSource?: DataSourceModeName;
}

/**
 * Prisma 플러그인
 * FastifyInstance에 prisma 데코레이터 추가
 */
const prismaPlugin = fp<PrismaPluginOptions>(async (fastify: FastifyInstance, options) => {
  const mode = resolveDataSourceMode(options.dataSource);

  // database · hybrid 는 URL 이 없으면 createPrismaClient 가 throw 한다 — fail-fast 유지
  if (mode === 'sheets' && !process.env.DATABASE_URL) {
    fastify.log.warn(
      { dataSourceMode: mode },
      'DATABASE_URL 미설정 — sheets 모드로 DB 없이 기동한다. DB 를 쓰는 요청은 503 으로 답한다'
    );
    fastify.decorate('prisma', createUnconfiguredPrismaClient());
    return;
  }

  // Prisma 7: 드라이버 어댑터로 만든다 (#241 · core createPrismaClient)
  const prisma = createPrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    onError: (message: string) => fastify.log.error(message),
  });

  // PrismaClient를 Fastify 인스턴스에 등록
  fastify.decorate('prisma', prisma);

  // 서버 종료 시 Prisma 연결 해제
  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
}, {
  name: 'prisma',
});

export default prismaPlugin;

// Fastify 타입 확장
declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}
