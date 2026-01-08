/**
 * Sync Service 메인 진입점
 * Google Sheets → PostgreSQL 동기화 서비스
 *
 * Issue #68 Phase 2.1
 */

import 'dotenv/config';
import { Config, SheetService, DatabaseService, ChangeLogService } from '@mytangerine/core';
import { SyncEngine } from './services/sync-engine.js';
import { PollingScheduler } from './schedulers/polling-scheduler.js';
import { logger } from './utils/logger.js';

/**
 * 메인 함수
 */
async function main() {
  try {
    logger.info('Initializing Sync Service...');

    // 환경 변수에서 설정 읽기
    const syncInterval = process.env.SYNC_INTERVAL || '*/1 * * * *'; // 기본: 1분
    const syncEnabled = process.env.SYNC_ENABLED !== 'false'; // 기본: true

    logger.info({ syncInterval, syncEnabled }, 'Sync configuration loaded');

    // Config 초기화
    const config = new Config();

    // SheetService 초기화
    const sheetService = new SheetService(config);
    logger.info('SheetService initialized');

    // DatabaseService 초기화
    const databaseService = new DatabaseService(config);
    logger.info('DatabaseService initialized');

    // ChangeLogService 초기화 (Phase 2: 충돌 감지용)
    const changeLogService = new ChangeLogService(databaseService.prisma);
    logger.info('ChangeLogService initialized');

    // SyncEngine 초기화 (logger + changeLogService 전달)
    const syncEngine = new SyncEngine(sheetService, databaseService, logger, changeLogService);
    logger.info('SyncEngine initialized');

    // PollingScheduler 초기화 및 시작
    const scheduler = new PollingScheduler(syncEngine, databaseService.prisma, {
      interval: syncInterval,
      enabled: syncEnabled,
    });

    scheduler.start();

    // Graceful shutdown 핸들러
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Received shutdown signal');

      // 스케줄러 중지 (새로운 동기화 예약 중단)
      scheduler.stop();

      // 실행 중인 동기화 작업 완료 대기 (최대 20분)
      await scheduler.waitForCurrentSync();

      // DatabaseService 연결 해제
      await databaseService.disconnect();
      logger.info('DatabaseService disconnected');

      logger.info('Graceful shutdown completed');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // 프로세스가 종료되지 않도록 유지
    process.on('uncaughtException', async (error) => {
      logger.error({ error: error.message, stack: error.stack }, 'Uncaught exception');
      await databaseService.disconnect();
      process.exit(1);
    });

    process.on('unhandledRejection', async (reason) => {
      logger.error({ reason }, 'Unhandled rejection');
      await databaseService.disconnect();
      process.exit(1);
    });

    logger.info('Sync Service started successfully');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'Failed to start Sync Service');
    process.exit(1);
  }
}

// 메인 함수 실행
main();
