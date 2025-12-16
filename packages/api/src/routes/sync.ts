/**
 * 동기화 관련 API 라우트
 */

import { FastifyPluginAsync } from 'fastify';
import { SyncEngine, withDistributedLock } from '@mytangerine/core';
import { requireApiKey, requireAppClient } from '../middleware/auth.js';

/**
 * 동기화 상태 캐시
 * - 캐시 만료 시간: 30초
 * - Google Sheets API 호출 빈도를 줄여 성능 개선 및 quota 절약
 */
interface SyncStatusCache {
  data: {
    sheets: {
      total: number;
      synced: number;
      pending: number;
      failed: number;
    };
    database: {
      total: number;
    };
    syncRate: number;
    lastSyncAt: string | null;
  };
  cachedAt: number;
}

let syncStatusCache: SyncStatusCache | null = null;
const CACHE_TTL_MS = 30 * 1000; // 30초

const syncRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/sync/status
   * 동기화 상태 조회 (Phase 2.2: 검증용)
   */
  fastify.get(
    '/api/sync/status',
    {
      preHandler: [requireApiKey, requireAppClient(['web', 'sync-service'])],
      schema: {
        tags: ['sync'],
        summary: '동기화 상태 조회',
        description: 'Google Sheets와 PostgreSQL 간 동기화 상태를 조회합니다. 캐싱 적용 (30초 TTL)으로 빈번한 호출에도 안정적입니다.',
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              status: {
                type: 'object',
                properties: {
                  sheets: {
                    type: 'object',
                    properties: {
                      total: { type: 'number', description: 'Sheets 전체 행 수' },
                      synced: { type: 'number', description: "동기화 완료된 행 수 (DB_SYNC_STATUS='success')" },
                      pending: { type: 'number', description: "대기 중인 행 수 (DB_SYNC_STATUS가 비어있거나 'success'/'fail'이 아닌 행)" },
                      failed: { type: 'number', description: "동기화 실패한 행 수 (DB_SYNC_STATUS='fail')" },
                    },
                  },
                  database: {
                    type: 'object',
                    properties: {
                      total: { type: 'number', description: 'DB 전체 레코드 수 (orders 테이블)' },
                    },
                  },
                  syncRate: { type: 'number', description: '동기화율 (synced/total * 100, %)' },
                  lastSyncAt: { type: 'string', nullable: true, description: '마지막 동기화 시간 (ISO 8601 형식, 예: "2024-02-01T12:34:56.789Z")' },
                },
              },
            },
          },
          500: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        // 캐시 확인
        const now = Date.now();
        if (syncStatusCache && now - syncStatusCache.cachedAt < CACHE_TTL_MS) {
          request.log.debug({ age: now - syncStatusCache.cachedAt }, 'Returning cached sync status');
          return reply.code(200).send({
            success: true,
            status: syncStatusCache.data,
          });
        }

        // 캐시 만료 또는 없음 → 새로 조회
        request.log.debug('Cache expired or not found, fetching sync status');

        // Sheets 데이터 조회
        const sheetRows = await fastify.core.sheetService.getAllRows();

        // 동기화 상태별 집계
        let synced = 0;
        let pending = 0;
        let failed = 0;
        let lastSyncAt: string | null = null;

        for (const row of sheetRows) {
          const syncStatus = row['DB_SYNC_STATUS'];
          const syncTime = row['DB_SYNC_AT'];

          if (syncStatus === 'success') {
            synced++;
            if (syncTime && (!lastSyncAt || syncTime > lastSyncAt)) {
              lastSyncAt = syncTime as string;
            }
          } else if (syncStatus === 'fail') {
            failed++;
          } else {
            pending++;
          }
        }

        // DB 레코드 수 조회
        const dbCount = await fastify.prisma.order.count();

        // 동기화율 계산
        const syncRate = sheetRows.length > 0
          ? Math.round((synced / sheetRows.length) * 100)
          : 0;

        const statusData = {
          sheets: {
            total: sheetRows.length,
            synced,
            pending,
            failed,
          },
          database: {
            total: dbCount,
          },
          syncRate,
          lastSyncAt,
        };

        // 캐시 업데이트
        syncStatusCache = {
          data: statusData,
          cachedAt: now,
        };

        request.log.info(
          {
            total: sheetRows.length,
            synced,
            pending,
            failed,
            dbCount,
            syncRate,
          },
          'Sync status fetched and cached'
        );

        return reply.code(200).send({
          success: true,
          status: statusData,
        });
      } catch (error) {
        fastify.log.error({ error }, 'Failed to get sync status');

        return reply.code(500).send({
          success: false,
          error: 'Failed to retrieve sync status',
        });
      }
    }
  );

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

        // 동기화 완료 시 캐시 무효화
        syncStatusCache = null;
        fastify.log.debug('Sync status cache invalidated after sync');

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
          message: '동기화 중 오류가 발생했습니다.',
        });
      }
    }
  );

  /**
   * POST /api/sync/full
   * 전체 재동기화 (Phase 2.2: 초기 데이터 적재 및 복구용)
   * 모든 행을 강제로 다시 동기화 (DB_SYNC_STATUS 무시)
   */
  fastify.post(
    '/api/sync/full',
    {
      preHandler: [requireApiKey, requireAppClient(['web', 'sync-service'])],
      schema: {
        tags: ['sync'],
        summary: '전체 재동기화',
        description: '모든 Google Sheets 데이터를 강제로 PostgreSQL에 재동기화합니다. 초기 데이터 적재 또는 불일치 복구용으로 사용합니다.',
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
                  skipped: { type: 'number', description: '건너뛴 행 수 (rowNumber 없음)' },
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
                  duration: { type: 'number', description: '소요 시간 (초)' },
                },
              },
            },
          },
          409: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
              message: { type: 'string' },
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
      const startTime = Date.now();

      try {
        // DB 기반 분산 락을 사용하여 동시 실행 방지
        const result = await withDistributedLock(
          fastify.prisma,
          'sync',
          requestId,
          async () => {
            // SyncEngine 인스턴스 생성
            const syncEngine = new SyncEngine(
              fastify.core.sheetService,
              fastify.core.databaseService,
              fastify.log
            );

            fastify.log.info('Starting full resync (Phase 2.2)...');

            // 전체 재동기화 실행
            const syncResult = await syncEngine.fullResync();

            const duration = Math.round((Date.now() - startTime) / 1000);
            fastify.log.info(
              {
                success: syncResult.success,
                failed: syncResult.failed,
                skipped: syncResult.skipped,
                duration: `${duration}s`
              },
              'Full resync completed'
            );

            return { ...syncResult, duration };
          },
          { ttlMs: 20 * 60 * 1000 } // 20분 TTL
        );

        // 동기화 완료 시 캐시 무효화
        syncStatusCache = null;
        fastify.log.debug('Sync status cache invalidated after full resync');

        return reply.code(200).send({
          success: true,
          message: `전체 동기화 완료: ${result.success}개 성공, ${result.failed}개 실패, ${result.skipped}개 건너뜀 (소요 시간: ${result.duration}초)`,
          result,
        });
      } catch (error) {
        fastify.log.error({ error }, 'Full resync failed');
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
          error: 'Full resync failed',
          message: '전체 동기화 중 오류가 발생했습니다.',
        });
      }
    }
  );
};

export default syncRoutes;
