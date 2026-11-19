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
import type { ReconcileAlertInput } from '../notifications/sync-alert.js';

/** #231 시트 재조정 — 알림에 넘길 결과 */
interface ReconcilerLike {
  reconcile(): Promise<ReconcileAlertInput & { reconciled: readonly number[]; stale: readonly number[] }>;
}

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
    private config: PollingSchedulerConfig,
    /** #251: 동기화 뒤 신규 주문 알림 발송 (HERMES_KEY 가 없으면 없음) */
    private notifier?: { flush(): Promise<unknown> },
    /** #260: 동기화 정지 · 연속 실패 경고 (HERMES_KEY 가 없으면 없음) */
    private alerter?: {
      onSyncResult(result: { identityConflictRows: readonly number[] }): Promise<void>;
      onSyncFailure(): Promise<void>;
      onReconcileResult?(result: ReconcileAlertInput): Promise<void>;
      onReconcileError?(): Promise<void>;
    },
    /** #231 hybrid 시트 반영 실패 자동 재조정 — 증분 동기화 뒤 같은 sync 락 안에서 */
    private reconciler?: ReconcilerLike
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
   * #231: 증분 동기화 뒤 시트 반영 실패 주문을 DB 값으로 다시 맞춘다(같은 sync 락 안).
   * 동기화가 멈춘 회차(행 밀림 · 행 정체성 정지)는 시트가 불안정하므로 건너뛴다.
   * 재조정 오류는 동기화 실패로 세지 않는다 — 로그만 남기고 다음 회차에 다시 한다.
   */
  private async reconcileAfterSync(syncResult: {
    rowShiftDetected?: boolean;
    identityConflictRows?: readonly number[];
  }): Promise<ReconcileAlertInput | null> {
    if (!this.reconciler) return null;
    if (syncResult.rowShiftDetected || (syncResult.identityConflictRows ?? []).length > 0) {
      logger.warn('Sync stopped on sheet row identity — skipping sheet reconcile this cycle (#231)');
      return null;
    }
    try {
      return await this.reconciler.reconcile();
    } catch (error) {
      // core 재조정기는 던지지 않지만, 던지면 연속 실패로 센다(알림 없이 멈추지 않게)
      logger.error(
        { error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined },
        'Sheet reconcile failed (#231)'
      );
      await this.alerter?.onReconcileError?.();
      return null;
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
      const { result, reconcile } = await withDistributedLock(
        this.prisma,
        'sync',
        this.processId,
        async () => {
          const syncResult = await this.syncEngine.incrementalSync();
          return { result: syncResult, reconcile: await this.reconcileAfterSync(syncResult) };
        },
        { ttlMs: 20 * 60 * 1000 } // 20분 TTL
      );

      logger.info(
        {
          total: result.total,
          success: result.success,
          failed: result.failed,
          skipped: result.skipped,
          newOrderNotices: result.newOrderNotices,
          replaced: result.replaced,
          replacementLimitHit: result.replacementLimitHit,
          // #261: 상태 칸 쓰기 전 · 후 확인에서 행 밀림 → 이번 실행 정지 · 남은 행 수
          rowShiftDetected: result.rowShiftDetected,
          unprocessed: result.unprocessed,
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

      // #260: 행 안전 정지가 있으면 경고(하루 1회) · 연속 실패 수 초기화
      // core dist 가 낡아 필드가 없어도 실패로 세지 않게 (core 는 타입 선언이 없어 any 로 들어온다)
      await this.alerter?.onSyncResult({ identityConflictRows: result.identityConflictRows ?? [] });
      if (reconcile) {
        await this.alerter?.onReconcileResult?.(reconcile);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // 락 획득 실패는 WARNING (API가 실행 중일 수 있음)
      if (message.includes('Lock') && message.includes('already acquired')) {
        logger.warn({ error: message }, 'Sync already in progress (manual or another scheduler), skipping this cycle');
      } else {
        logger.error({ error: message }, 'Scheduled sync failed');
        // #260: 락 충돌(건너뜀)은 세지 않는다 — 진짜 실패만 연속 횟수에
        await this.alerter?.onSyncFailure();
      }
    }

    // #251: 동기화 성공 여부와 상관없이 대기 알림을 보낸다(이전 회차에 표시된 것 포함).
    // 락 밖에서 돈다 — 알림은 시트·DB 동기화와 겹쳐도 안전하고(pending 일 때만 기록), flush 는 던지지 않는다
    if (this.notifier) {
      await this.notifier.flush();
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
