/**
 * 동기화 관련 API 라우트
 */

import { FastifyPluginAsync } from 'fastify';
import { SyncEngine, withDistributedLock } from '@mytangerine/core';
import { requireApiKey, requireAppClient } from '../middleware/auth.js';

const syncRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /api/sync
   * 수동 데이터 동기화 (Google Sheets → PostgreSQL)
   */
  fastify.post(
    '/api/sync',
    {
      preHandler: [requireApiKey, requireAppClient(['web', 'sync-service'])],
      // NOTE: 동기화 작업은 최대 20분 소요 가능
      // - 분산 락 TTL: 20분
      // - 클라이언트는 충분한 타임아웃 설정 필요 (Next.js proxy: 20분)
      schema: {
        tags: ['sync'],
        summary: '수동 데이터 동기화',
        description: 'Google Sheets의 데이터를 PostgreSQL로 동기화합니다.',
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
              result: {
                type: 'object',
                properties: {
                  total: { type: 'number', description: '전체 행 수' },
                  success: { type: 'number', description: '성공한 행 수' },
                  failed: { type: 'number', description: '실패한 행 수' },
                  skipped: { type: 'number', description: '건너뛴 행 수 (이미 동기화됨)' },
                  errors: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        rowNumber: { type: 'number' },
                        error: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
          500: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const requestId = request.id;

      try {
        // DB 기반 분산 락을 사용하여 동시 실행 방지
        const result = await withDistributedLock(
          fastify.prisma,
          'sync',
          requestId,
          async () => {
            // SyncEngine 인스턴스 생성 (Fastify logger 전달)
            const syncEngine = new SyncEngine(
              fastify.core.sheetService,
              fastify.core.databaseService,
              fastify.log
            );

            fastify.log.info('Starting manual sync...');

            // 증분 동기화 실행
            const syncResult = await syncEngine.incrementalSync();

            fastify.log.info(
              { success: syncResult.success, failed: syncResult.failed, skipped: syncResult.skipped },
              'Manual sync completed'
            );

            return syncResult;
          },
          { ttlMs: 20 * 60 * 1000 } // 20분 TTL
        );

        return reply.code(200).send({
          success: true,
          message: `동기화 완료: ${result.success}개 성공, ${result.failed}개 실패, ${result.skipped}개 건너뜀`,
          result,
        });
      } catch (error) {
        fastify.log.error({ error }, 'Manual sync failed');
        const message = error instanceof Error ? error.message : String(error);

        // 락 획득 실패 시 409 Conflict 반환
        if (message.includes('Lock') && message.includes('already acquired')) {
          return reply.code(409).send({
            success: false,
            error: 'Sync already in progress',
            message: '다른 동기화 작업이 진행 중입니다. 완료될 때까지 기다려주세요.',
          });
        }

        return reply.code(500).send({
          success: false,
          error: 'Sync failed',
          message,
        });
      }
    }
  );
};

export default syncRoutes;
