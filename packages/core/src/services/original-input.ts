/**
 * 최초 입력값 (#281 — hybrid DB 우선)
 *
 * hybrid 운영의 정본은 DB 이고, 웹 수정은 DB · 시트 모두에 반영된다. 그래서 주문자가 처음 입력한 값은
 * 주문이 만들어질 때 한 번 `orders.original_input` 에 보관하고 이후 바꾸지 않는다.
 * 이 기능 이전 주문은 비워 둔다 — 원본을 확실히 알 수 없다(사용자 2026-11-19).
 *
 * 저장 대상은 시트 헤더 전체에서 앱이 쓰는 칸과 내부 키(`_` 로 시작)를 뺀 나머지다 — 고정 목록이 아니라서
 * DB 컬럼에 없는 폼 질문도 보존된다.
 */

import type { SheetRow } from '../types/order.js';

/** 앱(관리자 · 동기화)이 쓰는 시트 칸 — 주문자 입력이 아니다. `주문유형` 은 관리자 칸(2026-11-19 사용자 확인) */
export const APP_MANAGED_COLUMNS: ReadonlySet<string> = new Set([
  '비고',
  '송장번호',
  '삭제됨',
  '주문유형',
  'DB_SYNC_STATUS',
  'DB_SYNC_AT',
  'DB_SYNC_ID',
]);

export type OriginalInput = Record<string, string>;

export function buildOriginalInput(row: SheetRow): OriginalInput {
  return Object.fromEntries(
    Object.entries(row as unknown as Record<string, unknown>)
      .filter(([key]) => !key.startsWith('_') && !APP_MANAGED_COLUMNS.has(key))
      .map(([key, value]) => [key, value === undefined || value === null ? '' : String(value)])
  );
}
