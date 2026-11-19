/**
 * 신규 주문 알림 표시 규칙 (#251)
 *
 * cron 동기화(sync-service)가 주문을 DB 에 **처음 만들 때** 이 규칙으로 newOrderNotice='pending' 을 기록한다.
 * 실제 발송(hermes)은 sync-service 가 하고, api 수동 동기화는 정책을 넘기지 않아 표시하지 않는다(사용자 2026-11-19).
 */

/** 알림 상태 — null 은 알림 대상이 아님 */
export type NewOrderNoticeStatus = 'pending' | 'sent' | 'rejected';

/** 기본 창: 주문 시각이 지금으로부터 24시간 안인 주문만 (사용자 2026-11-19 · 대량 알림 방지) */
export const NEW_ORDER_NOTICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface NewOrderNoticePolicy {
  /** 주문 시각과 지금의 차이 허용 폭 */
  windowMs: number;
  /** 시험용 시계 */
  now?: () => Date;
}

/**
 * 새로 만드는 주문에 알림 표시를 할지.
 *
 * - '삭제됨' 표시(deletedAt 이 Date)면 하지 않는다
 * - 주문 시각과 지금의 **절대 차이**가 창 안이어야 한다. 시트 타임스탬프는 실행 환경의 로컬 시간으로 읽히므로
 *   (parseKoreanTimestamp) 서버 시간대가 KST 가 아니면 몇 시간 미래처럼 보일 수 있다 — 그래도 창 안이면 최근 주문이다
 * - 시각을 읽지 못했으면(Invalid Date) 하지 않는다
 */
export function shouldFlagNewOrderNotice(
  data: { timestamp: Date; deletedAt: Date | null | undefined },
  policy: NewOrderNoticePolicy | undefined
): boolean {
  if (!policy) return false;
  if (data.deletedAt instanceof Date) return false;

  const orderTime = data.timestamp.getTime();
  if (Number.isNaN(orderTime)) return false;

  const now = (policy.now ?? (() => new Date()))().getTime();
  return Math.abs(now - orderTime) <= policy.windowMs;
}
