/**
 * 신규 주문 알림 메시지 (#251 · hermes API §2 필드)
 *
 * 사람을 특정하는 값(이름 · 주소 · 전화 · 이메일 · 계좌)은 넣지 않는다 — 문구와 관리 화면 링크만(사용자 2026-11-19).
 * 링크는 웹 주문 상세 `/orders/<시트 행 번호>` — sync 로 만들어진 주문은 늘 시트 행이 있다.
 */

export const NEW_ORDER_TITLE = '새 주문';
export const NEW_ORDER_TEXT = '신규 주문이 추가되었습니다.';
export const NEW_ORDER_LINK_LABEL = '주문 상세';

export interface HermesMessage {
  title: string;
  text: string;
  link?: { label: string; url: string };
  level: 'info' | 'warn';
}

export function buildNewOrderMessage(sheetRowNumber: number, adminWebUrl: string | undefined): HermesMessage {
  const base = { title: NEW_ORDER_TITLE, text: NEW_ORDER_TEXT, level: 'info' as const };
  if (!adminWebUrl) return base;
  return { ...base, link: { label: NEW_ORDER_LINK_LABEL, url: `${adminWebUrl}/orders/${sheetRowNumber}` } };
}
