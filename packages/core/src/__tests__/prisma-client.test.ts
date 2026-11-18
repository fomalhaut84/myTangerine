/**
 * Prisma client 생성 위치 회귀 테스트 (#208)
 *
 * `@prisma/client` 는 pnpm 저장소 안 자기 옆의 `.prisma/client` 를 읽는다. 스키마 generator 에
 * 상대경로 `output` 이 있던 시절에는 client 가 다른 곳(루트 `node_modules/.prisma`)에 생성돼,
 * core 가 읽는 client 가 "did not initialize yet" 껍데기이거나 낡은 타입(OrderChangeLog 없음)이었다.
 * 정본 스키마는 루트 `prisma/schema.prisma` 하나이고 output 을 지정하지 않는다.
 *
 * DB 에 접속하지 않는다(생성자만 호출 · $connect 없음 — S-4).
 */
import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { createPrismaClient } from '../services/prisma-client-factory.js';

describe('generated Prisma client (#208)', () => {
  it('is the generated client, not the uninitialized stub', () => {
    // Prisma 7: 실제 드라이버 어댑터로 만든다(#241) — 생성자만, 접속하지 않는다
    const client = createPrismaClient({ databaseUrl: 'postgresql://user:password@localhost:5432/never-connected' });
    expect(typeof client.order.findMany).toBe('function');
  });

  it('includes every model of the canonical schema', () => {
    expect(Object.keys(Prisma.ModelName).sort()).toEqual(
      ['DistributedLock', 'Order', 'OrderChangeLog', 'SyncLog'].sort()
    );
  });
});
