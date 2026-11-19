/**
 * 신규 주문 알림 발송기 (#251)
 *
 * cron 동기화가 끝난 뒤 불린다. 알림 대기(pending) 주문을 오래된 것부터 보내고 결과를 DB 에 기록한다.
 * - 202 → sent · 400/413 → rejected · 보낼 때 주문 시각이 창 밖 → expired(보내지 않음)
 * - 401/403(키 틀림·만료) → 기록하지 않고 **이 프로세스에서 발송·표시를 멈춘다**(키 교체 = .env 수정 + 재시작)
 * - 그 밖의 실패(429 · 5xx · 연결 실패 · 시간 초과) → 대기 유지 · 이번 회차 중단 → 다음 cron 에 같은 키로 재시도
 * - 어떤 오류도 던지지 않는다 — 알림이 동기화를 막지 않는다
 */

import { buildNewOrderMessage, type HermesMessage } from './new-order-message.js';
import type { HermesOutcome } from './hermes-client.js';

export const DEFAULT_NOTICE_BATCH_SIZE = 20;

export interface NoticeStore {
  getPendingNewOrderNotices(limit: number): Promise<Array<{ id: number; sheetRowNumber: number; timestamp: Date }>>;
  setNewOrderNoticeResult(id: number, status: 'sent' | 'rejected' | 'expired'): Promise<boolean>;
}

export interface NoticeLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface NewOrderNotifierDeps {
  store: NoticeStore;
  send: (message: HermesMessage, idempotencyKey: string) => Promise<HermesOutcome>;
  /** 보낼 때 주문 시각이 알림 창 안인지 (운영: core isWithinNoticeWindow) */
  isFresh: (timestamp: Date) => boolean;
  logger: NoticeLogger;
  adminWebUrl?: string;
  batchSize?: number;
}

export interface FlushResult {
  sent: number;
  rejected: number;
  expired: number;
  /** 이번 회차를 끝까지 못 돌았다(재시도 대기 · 키 거부 · DB 오류) */
  halted: boolean;
  /** 이미 도는 중이거나 키 거부로 멈춰서 아무것도 하지 않았다 */
  skipped?: true;
}

export class NewOrderNotifier {
  private active = true;
  private running = false;

  constructor(private readonly deps: NewOrderNotifierDeps) {}

  /** false 면 키가 거부된 뒤다 — SyncEngine 표시 정책의 isActive 로도 쓴다 */
  isActive(): boolean {
    return this.active;
  }

  async flush(): Promise<FlushResult> {
    if (!this.active) return { sent: 0, rejected: 0, expired: 0, halted: true, skipped: true };
    if (this.running) return { sent: 0, rejected: 0, expired: 0, halted: false, skipped: true };

    this.running = true;
    try {
      return await this.run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logger.error({ error: message }, 'New order notice flush failed');
      return { sent: 0, rejected: 0, expired: 0, halted: true };
    } finally {
      this.running = false;
    }
  }

  private async run(): Promise<FlushResult> {
    const { store, send, isFresh, logger, adminWebUrl } = this.deps;
    const pending = await store.getPendingNewOrderNotices(this.deps.batchSize ?? DEFAULT_NOTICE_BATCH_SIZE);
    const result: FlushResult = { sent: 0, rejected: 0, expired: 0, halted: false };

    for (const order of pending) {
      if (!isFresh(order.timestamp)) {
        await store.setNewOrderNoticeResult(order.id, 'expired');
        result.expired++;
        continue;
      }

      const outcome = await send(buildNewOrderMessage(order.sheetRowNumber, adminWebUrl), `order-${order.id}`);

      if (outcome.kind === 'accepted') {
        await store.setNewOrderNoticeResult(order.id, 'sent');
        result.sent++;
        continue;
      }
      if (outcome.kind === 'rejected') {
        await store.setNewOrderNoticeResult(order.id, 'rejected');
        logger.warn({ orderId: order.id, status: outcome.status }, 'hermes rejected new order notice');
        result.rejected++;
        continue;
      }
      if (outcome.kind === 'key-rejected') {
        this.active = false;
        logger.error(
          { status: outcome.status },
          'hermes rejected the key (401 missing/invalid · 403 disabled/expired) — new order notices stopped until restart'
        );
        return { ...result, halted: true };
      }

      logger.warn(
        { orderId: order.id, reason: outcome.reason, status: outcome.status, retryAfterSec: outcome.retryAfterSec },
        'hermes unavailable — new order notices will retry next cycle'
      );
      return { ...result, halted: true };
    }

    if (result.sent + result.rejected + result.expired > 0) {
      logger.info({ ...result }, 'New order notices processed');
    }
    return result;
  }
}
