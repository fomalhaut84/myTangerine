/**
 * PollingScheduler
 * node-cron 기반 폴링 스케줄러
 *
 * Issue #68 Phase 2.1
 */

import cron from 'node-cron';
import type { SyncEngine } from '../services/sync-engine.js';
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
  private isRunning = false;

  constructor(
    private syncEngine: SyncEngine,
    private config: PollingSchedulerConfig
  ) {}

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

    this.task = cron.schedule(this.config.interval, async () => {
      await this.runSync();
    });

    logger.info('Polling scheduler started');

    // Graceful shutdown 핸들러
    this.setupShutdownHandlers();
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
   * 동기화 실행 (내부용)
   */
  private async runSync(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Sync already in progress, skipping this cycle');
      return;
    }

    this.isRunning = true;

    try {
      logger.info('Starting scheduled sync...');
      const result = await this.syncEngine.incrementalSync();

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
      logger.error({ error: message }, 'Scheduled sync failed');
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 수동 트리거 (즉시 실행)
   */
  async syncNow(): Promise<void> {
    logger.info('Manual sync triggered');
    await this.runSync();
  }

  /**
   * Graceful shutdown 핸들러 설정
   */
  private setupShutdownHandlers(): void {
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Received shutdown signal');

      // 실행 중인 싱크가 있으면 완료될 때까지 대기
      if (this.isRunning) {
        logger.info('Waiting for current sync to complete...');
        while (this.isRunning) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      this.stop();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }
}
