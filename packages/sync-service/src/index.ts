/**
 * Sync Service 메인 진입점
 * Google Sheets → PostgreSQL 동기화 서비스
 *
 * Issue #68 Phase 2.1
 */

import 'dotenv/config';
import { Config, SheetService, DatabaseService } from '@mytangerine/core';
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

    // SyncEngine 초기화
    const syncEngine = new SyncEngine(sheetService, databaseService);
    logger.info('SyncEngine initialized');

    // PollingScheduler 초기화 및 시작
    const scheduler = new PollingScheduler(syncEngine, {
      interval: syncInterval,
      enabled: syncEnabled,
    });

    scheduler.start();

    // 프로세스가 종료되지 않도록 유지
    process.on('uncaughtException', (error) => {
      logger.error({ error: error.message, stack: error.stack }, 'Uncaught exception');
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      logger.error({ reason }, 'Unhandled rejection');
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
