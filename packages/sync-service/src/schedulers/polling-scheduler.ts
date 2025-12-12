/**
 * PollingScheduler
 * node-cron 기반 폴링 스케줄러
 *
 * Issue #68 Phase 2.1
 */

import cron from 'node-cron';
import type { SyncEngine } from '../services/sync-engine.js';
import { withDistributedLock } from '@mytangerine/core';
import type { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';

/**
 * 폴링 스케줄러 설정
 */
export interface PollingSchedulerConfig {
  /** cron 표현식 (예: every 1 minute) */
  interval: string;
  /** 서비스 활성화 여부 */
  enabled: boolean;
}

/**
 * 폴링 스케줄러 클래스
 */
export class PollingScheduler {
  private task: cron.ScheduledTask | null = null;
  private processId: string;
  private currentSyncPromise: Promise<void> | null = null;

  constructor(
    private syncEngine: SyncEngine,
    private prisma: PrismaClient,
    private config: PollingSchedulerConfig
  ) {
    // Process ID 생성 (sync-service + PID + timestamp)
    this.processId = `sync-service-${process.pid}-${Date.now()}`;
  }

  /**
   * 스케줄러 시작
   */
  start(): void {
    if (!this.config.enabled) {
      logger.info('Sync service is disabled (SYNC_ENABLED=false)');
      return;
    }

    if (this.task) {
      logger.warn('Scheduler already started');
      return;
    }

    // cron 표현식 검증
    if (!cron.validate(this.config.interval)) {
      throw new Error(`Invalid cron expression: ${this.config.interval}`);
    }

    logger.info(
      { interval: this.config.interval },
      'Starting polling scheduler...'
    );

    this.task = cron.schedule(this.config.interval, () => {
      // 동시에 여러 sync가 실행되지 않도록 promise 추적
      if (!this.currentSyncPromise) {
        this.currentSyncPromise = this.runSync().finally(() => {
          this.currentSyncPromise = null;
        });
      }
    });

    logger.info('Polling scheduler started');
  }

  /**
   * 스케줄러 중지
   */
  stop(): void {
    if (!this.task) {
      logger.warn('Scheduler not running');
      return;
    }

    logger.info('Stopping polling scheduler...');
    this.task.stop();
    this.task = null;
    logger.info('Polling scheduler stopped');
  }

  /**
   * 현재 실행 중인 동기화 작업 대기
   * Graceful shutdown에 사용
   */
  async waitForCurrentSync(): Promise<void> {
    if (this.currentSyncPromise) {
      logger.info('Waiting for current sync to complete...');
      await this.currentSyncPromise;
      logger.info('Current sync completed');
    }
  }

  /**
   * 동기화 실행 (내부용)
   * DB 기반 분산 락으로 API와 충돌 방지
   */
  private async runSync(): Promise<void> {
    try {
      logger.info('Starting scheduled sync...');

      // DB 기반 분산 락으로 API 수동 동기화와 충돌 방지
      const result = await withDistributedLock(
        this.prisma,
        'sync',
        this.processId,
        async () => {
          return await this.syncEngine.incrementalSync();
        },
        { ttlMs: 20 * 60 * 1000 } // 20분 TTL
      );

      logger.info(
        {
          total: result.total,
          success: result.success,
          failed: result.failed,
          skipped: result.skipped,
        },
        'Scheduled sync completed'
      );

      // 실패한 행이 있으면 에러 로그
      if (result.failed > 0) {
        logger.error(
          { errors: result.errors },
          `${result.failed} row(s) failed to sync`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // 락 획득 실패는 WARNING (API가 실행 중일 수 있음)
      if (message.includes('Lock') && message.includes('already acquired')) {
        logger.warn({ error: message }, 'Sync already in progress (manual or another scheduler), skipping this cycle');
      } else {
        logger.error({ error: message }, 'Scheduled sync failed');
      }
    }
  }

  /**
   * 수동 트리거 (즉시 실행)
   */
  async syncNow(): Promise<void> {
    logger.info('Manual sync triggered');

    // 현재 실행 중인 sync가 있으면 대기
    if (this.currentSyncPromise) {
      logger.info('Another sync is in progress, waiting...');
      await this.currentSyncPromise;
    }

    // Promise 추적하면서 실행
    this.currentSyncPromise = this.runSync().finally(() => {
      this.currentSyncPromise = null;
    });

    await this.currentSyncPromise;
  }

}
