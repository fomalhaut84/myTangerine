/**
 * Prisma 플러그인
 * PrismaClient를 Fastify 데코레이터로 등록
 *
 * Issue #68 Phase 2.1
 */

import { PrismaClient } from '@prisma/client';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';

/**
 * Prisma 플러그인
 * FastifyInstance에 prisma 데코레이터 추가
 */
const prismaPlugin = fp(async (fastify: FastifyInstance) => {
  const prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

  // PrismaClient를 Fastify 인스턴스에 등록
  fastify.decorate('prisma', prisma);

  // 서버 종료 시 Prisma 연결 해제
  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
});

export default prismaPlugin;

// Fastify 타입 확장
declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}
