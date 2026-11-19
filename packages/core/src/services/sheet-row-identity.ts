/**
 * 시트 행 ↔ DB 주문 정체성 (#257)
 *
 * DB 는 주문을 시트 **행 번호**로 기억한다. 그런데 행 번호는 바뀔 수 있다:
 * - 시트 중간 행을 지우면 아래 행이 올라간다
 * - 구글 폼은 새 응답을 "마지막 폼 응답 바로 아래"에 **끼워 넣어** 손으로 넣은 행을 아래로 민다 (2026-11-19 운영 관찰)
 * 그래서 같은 행 번호의 DB 주문이 정말 그 시트 행의 주문인지를 주문 시각으로 확인한다(웹은 타임스탬프를 바꾸지 않는다).
 *
 * 비교 순서 — 시간대 오탐을 막기 위해 **원문 문자열을 먼저** 본다:
 * 1) 정규화한 원문(timestampRaw ↔ 시트 `타임스탬프`)이 같으면 같은 주문
 * 2) 다르면 해석한 시각(parseKoreanTimestamp — 프로세스 로컬 시간대)으로 한 번 더
 * 3) 시트 값이 비었거나 읽을 수 없으면 판정하지 않는다(같은 주문으로 본다 — 기존 동작)
 */

import { parseKoreanTimestamp } from '../types/order.js';

/** 한 번의 동기화에서 "행 재사용 교체"를 이만큼까지만 한다 — 넘으면 동기화를 멈춘다(오판이 대량 변경으로 번지지 않게) */
export const MAX_ROW_REPLACEMENTS_PER_SYNC = 3;

/** 표시 형식 차이("19 오전" · "19. 오전" · 공백)를 지운 비교용 문자열 */
export function normalizeTimestampRaw(raw: string | null | undefined): string {
  return (raw ?? '').replace(/[.\s]/g, '');
}

export function parseSheetTimestamp(raw: string | null | undefined): Date | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = parseKoreanTimestamp(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    return null;
  }
}

/**
 * DB 주문과 시트 행이 같은 주문인지. 판정할 수 없으면 true(기존처럼 갱신).
 */
export function isSameOrder(
  existing: { timestamp: Date; timestampRaw: string | null },
  sheetRaw: string | null | undefined
): boolean {
  const sheetKey = normalizeTimestampRaw(sheetRaw);
  if (!sheetKey) return true;
  if (normalizeTimestampRaw(existing.timestampRaw) === sheetKey) return true;

  const sheetTime = parseSheetTimestamp(sheetRaw);
  if (!sheetTime) return true;
  return existing.timestamp.getTime() === sheetTime.getTime();
}

/** 이번 동기화 시트 스냅샷의 정체성 색인: 정규화 원문 → 그 값을 가진 행 번호들 */
export type SheetIdentityIndex = ReadonlyMap<string, readonly number[]>;

export function buildSheetIdentityIndex(
  rows: ReadonlyArray<{ _rowNumber?: number; 타임스탬프?: string }>
): SheetIdentityIndex {
  const index = new Map<string, number[]>();
  for (const row of rows) {
    const key = normalizeTimestampRaw(row.타임스탬프);
    if (!key || !row._rowNumber) continue;
    index.set(key, [...(index.get(key) ?? []), row._rowNumber]);
  }
  return index;
}

/** 이 정규화 원문의 주문이 시트의 **다른** 행에 있는지 */
export function appearsAtOtherRow(index: SheetIdentityIndex, raw: string | null | undefined, rowNumber: number): boolean {
  const key = normalizeTimestampRaw(raw);
  if (!key) return false;
  return (index.get(key) ?? []).some((n) => n !== rowNumber);
}
