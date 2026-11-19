/**
 * 동기화 정지 · 실패 경고 (#260)
 *
 * 운영 pm2 로그에 앱 로그가 남지 않아(#256) 동기화가 멈춰도 알 길이 없다. 그래서 `#hermes` 로 warn 을 보낸다.
 * - 행 안전 정지(#257 행 정체성 충돌 · 교체 상한): 정지 행 번호만 — 고객 정보 없음
 * - 동기화 전체 실패가 연속 FAILURE_THRESHOLD 회 이상(락 충돌로 건너뛴 회차는 세지 않는다 — 호출자가 거른다)
 * - 같은 종류는 **하루 1회**(Idempotency-Key 에 한국 날짜) — 정지는 매분 반복되므로 채널이 넘치지 않게
 * - hermes 가 키를 거부하면(401·403) 이 프로세스에서 더 보내지 않는다 · 어떤 오류도 던지지 않는다(동기화를 막지 않는다)
 */

import type { HermesMessage } from './new-order-message.js';
import type { HermesOutcome } from './hermes-client.js';
import type { NoticeLogger } from './new-order-notifier.js';

export const FAILURE_THRESHOLD = 5;
const MAX_LISTED_ROWS = 5;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 한국 날짜 YYYY-MM-DD — 서버 시간대와 무관 */
export function kstDateKey(now: Date): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function ordersLink(adminWebUrl: string | undefined): Pick<HermesMessage, 'link'> {
  return adminWebUrl ? { link: { label: '주문 목록', url: `${adminWebUrl}/orders` } } : {};
}

export function buildSyncStallMessage(rows: readonly number[], adminWebUrl: string | undefined): HermesMessage {
  const listed = rows.slice(0, MAX_LISTED_ROWS).join(', ');
  const more = rows.length > MAX_LISTED_ROWS ? ` 외 ${rows.length - MAX_LISTED_ROWS}건` : '';
  return {
    title: '동기화 정지',
    text: `시트 행 확인(행 순서 불일치 · 교체 상한)으로 동기화하지 못한 행 ${rows.length}건 (행 ${listed}${more}) — 시트 행 순서를 확인해 주세요.`,
    ...ordersLink(adminWebUrl),
    level: 'warn',
  };
}

export function buildSyncFailureMessage(consecutive: number, adminWebUrl: string | undefined): HermesMessage {
  return {
    title: '동기화 실패',
    text: `시트 → DB 동기화가 ${consecutive}회 연속 실패했습니다 — 서버 로그 · DB · 구글 시트 접근을 확인해 주세요.`,
    ...ordersLink(adminWebUrl),
    level: 'warn',
  };
}

export function buildReconcileStallMessage(rows: readonly number[], adminWebUrl: string | undefined): HermesMessage {
  const listed = rows.slice(0, MAX_LISTED_ROWS).join(', ');
  const more = rows.length > MAX_LISTED_ROWS ? ` 외 ${rows.length - MAX_LISTED_ROWS}건` : '';
  return {
    title: '시트 재조정 정지',
    text: `시트 반영 실패 주문을 다시 맞추려 했지만 시트 행이 그 주문이 아니어서 쓰지 않은 행 ${rows.length}건 (행 ${listed}${more}) — 시트 행 순서를 확인해 주세요. DB 가 정본이라 업무 화면은 정상입니다.`,
    ...ordersLink(adminWebUrl),
    level: 'warn',
  };
}

export function buildReconcileShiftedMessage(
  shifted: ReadonlyArray<{ rowNumber: number; cells: number }>,
  adminWebUrl: string | undefined
): HermesMessage {
  const listed = shifted
    .slice(0, MAX_LISTED_ROWS)
    .map((s) => `행 ${s.rowNumber}(${s.cells}칸)`)
    .join(', ');
  const more = shifted.length > MAX_LISTED_ROWS ? ` 외 ${shifted.length - MAX_LISTED_ROWS}건` : '';
  return {
    title: '시트 재조정 — 다른 행에 써졌을 수 있음',
    text:
      `DB → 시트 재조정이 쓴 직후 시트 행이 바뀌었습니다: ${listed}${more}. ` +
      '그 칸들이 다른 주문 행에 써졌을 수 있습니다 — 시트 "버전 기록" 으로 해당 행을 확인해 주세요(고객 최초 입력값은 주문 상세에 있습니다).',
    ...ordersLink(adminWebUrl),
    level: 'warn',
  };
}

export function buildReconcileFailureMessage(consecutive: number, adminWebUrl: string | undefined): HermesMessage {
  return {
    title: '시트 재조정 실패',
    text: `DB → 시트 재조정이 ${consecutive}회 연속 실패했습니다 — 구글 시트 접근 · 서버 로그를 확인해 주세요. DB 가 정본이라 업무 화면은 정상입니다.`,
    ...ordersLink(adminWebUrl),
    level: 'warn',
  };
}

/** #231 재조정 결과 중 알림에 필요한 것 */
export interface ReconcileAlertInput {
  attempted: number;
  skippedIdentity: readonly number[];
  shiftedAfterWrite: ReadonlyArray<{ rowNumber: number; cells: number }>;
  failed: readonly unknown[];
  reconciled?: readonly number[];
  stale?: readonly number[];
}

export interface SyncAlerterDeps {
  send: (message: HermesMessage, idempotencyKey: string) => Promise<HermesOutcome>;
  logger: NoticeLogger;
  adminWebUrl?: string;
  /** 신규 주문 알림이 키 거부로 멈췄는지 — 같은 키를 쓰므로 함께 멈춘다 */
  isActive?: () => boolean;
  now?: () => Date;
  failureThreshold?: number;
}

export class SyncAlerter {
  private active = true;
  private consecutiveFailures = 0;
  private consecutiveReconcileFailures = 0;
  private readonly sentKeys = new Set<string>();

  constructor(private readonly deps: SyncAlerterDeps) {}

  /** 동기화가 끝까지 돈 회차 — 연속 실패 수를 0 으로, 정지 행이 있으면 경고 */
  async onSyncResult(result: { identityConflictRows: readonly number[] }): Promise<void> {
    this.consecutiveFailures = 0;
    if (result.identityConflictRows.length === 0) return;
    await this.sendOncePerDay('sync-stall', buildSyncStallMessage(result.identityConflictRows, this.deps.adminWebUrl));
  }

  /**
   * #231 시트 재조정 결과 — 행이 어긋나 쓰지 못한 행이 있으면 하루 1회, 쓰기 실패가 연속 임계값 이상이면 하루 1회.
   * 대상이 없던 회차는 연속 수를 바꾸지 않는다.
   */
  async onReconcileResult(result: ReconcileAlertInput): Promise<void> {
    // 썼는데 직후 행이 바뀜 — 다른 주문 행에 써졌을 수 있다. 행이 다르면 같은 날에도 따로 알린다(묻히지 않게)
    if (result.shiftedAfterWrite.length > 0) {
      const rows = result.shiftedAfterWrite.map((s) => s.rowNumber).join('_');
      await this.sendOncePerDay(
        `sheet-reconcile-written-shifted-${rows}`,
        buildReconcileShiftedMessage(result.shiftedAfterWrite, this.deps.adminWebUrl)
      );
    }
    if (result.skippedIdentity.length > 0) {
      await this.sendOncePerDay('sheet-reconcile-stall', buildReconcileStallMessage(result.skippedIdentity, this.deps.adminWebUrl));
    }
    if (result.failed.length === 0) {
      if (result.attempted > 0) this.consecutiveReconcileFailures = 0;
      return;
    }
    await this.countReconcileFailure();
  }

  /** 재조정이 예외로 끝난 회차 — 결과가 없어도 연속 실패로 센다(알림 없이 멈추지 않게) */
  async onReconcileError(): Promise<void> {
    await this.countReconcileFailure();
  }

  private async countReconcileFailure(): Promise<void> {
    this.consecutiveReconcileFailures++;
    if (this.consecutiveReconcileFailures < (this.deps.failureThreshold ?? FAILURE_THRESHOLD)) return;
    await this.sendOncePerDay(
      'sheet-reconcile-failure',
      buildReconcileFailureMessage(this.consecutiveReconcileFailures, this.deps.adminWebUrl)
    );
  }

  /** 동기화 전체가 실패한 회차(락 충돌 제외) */
  async onSyncFailure(): Promise<void> {
    this.consecutiveFailures++;
    if (this.consecutiveFailures < (this.deps.failureThreshold ?? FAILURE_THRESHOLD)) return;
    await this.sendOncePerDay('sync-failure', buildSyncFailureMessage(this.consecutiveFailures, this.deps.adminWebUrl));
  }

  private async sendOncePerDay(kind: string, message: HermesMessage): Promise<void> {
    if (!this.active || (this.deps.isActive && !this.deps.isActive())) return;
    const key = `${kind}-${kstDateKey((this.deps.now ?? (() => new Date()))())}`;
    if (this.sentKeys.has(key)) return;

    try {
      const outcome = await this.deps.send(message, key);
      if (outcome.kind === 'accepted' || outcome.kind === 'rejected') {
        // rejected(400·413)는 고쳐 보내기 전에는 다시 보내도 같다 — 같은 날 반복하지 않는다
        this.sentKeys.add(key);
        if (outcome.kind === 'rejected') {
          this.deps.logger.warn({ kind, status: outcome.status }, 'hermes rejected sync alert');
        }
        return;
      }
      if (outcome.kind === 'key-rejected') {
        this.active = false;
        this.deps.logger.error({ status: outcome.status }, 'hermes rejected the key — sync alerts stopped until restart');
        return;
      }
      this.deps.logger.warn({ kind, reason: outcome.reason, status: outcome.status }, 'hermes unavailable — sync alert will retry next cycle');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.deps.logger.error({ kind, error: msg }, 'Sync alert failed');
    }
  }
}
