/**
 * 폼 선택지 문구 — 단가의 정본 (#317)
 *
 * 구글 폼 `상품 선택` 선택지는 `10kg (38,000 / box)` 형식이고, 주문마다 그 문구가 원문으로 들어온다.
 * 단가는 시즌마다 **폼에서** 정한다 — 앱은 원문 단가를 읽기만 하고 만들지 않는다(사용자 2026-11-20).
 * 그래서 가격이 바뀌어도 이미 들어온 주문의 원문 · 금액은 그대로다.
 *
 * 시즌: 11월 하순 ~ 다음 해 1월 중순(해를 넘긴다). 7월을 경계로 나눈다 — 7월 ~ 다음 해 6월이 한 시즌.
 */
import { resolveProductSelection } from './products.js';

/** 시즌이 시작하는 달(0 = 1월) — 이 달부터 다음 해 이 달 전까지가 한 시즌 */
const SEASON_START_MONTH = 6;

/** `(38,000 / box)` 의 단가 — 콤마 허용 · 공백 허용 */
const UNIT_PRICE_PATTERN = /\(\s*([\d,]+)\s*\/\s*box\s*\)/i;

/** 원문의 단가(원). 없거나 읽을 수 없으면 null */
export function parseUnitPrice(selection: string | null | undefined): number | null {
  if (!selection) return null;
  const match = UNIT_PRICE_PATTERN.exec(selection);
  if (!match) return null;
  const digits = match[1].replace(/,/g, '');
  if (digits === '') return null;
  const price = Number(digits);
  return Number.isSafeInteger(price) && price > 0 ? price : null;
}

/** 시즌 연도 — 그 시즌이 시작한 해 (2025-12-01 · 2026-01-10 → 2025) */
export function seasonOf(date: Date): number {
  return date.getMonth() >= SEASON_START_MONTH ? date.getFullYear() : date.getFullYear() - 1;
}

export interface SelectionCandidate {
  productSelection: string;
  timestamp: Date;
}

/**
 * 같은 시즌에 들어온 그 상품 주문의 폼 문구 — 웹에서 오주문 상품을 바꿀 때 쓴다.
 * 단가가 있는 원문만 보고, 바꾸는 주문의 시각에 가장 가까운 것을 고른다. 없으면 null(단가를 지어내지 않는다).
 */
export function pickSeasonSelection(
  candidates: readonly SelectionCandidate[],
  productType: string,
  orderTimestamp: Date
): string | null {
  const season = seasonOf(orderTimestamp);
  const target = orderTimestamp.getTime();
  let best: { selection: string; distance: number } | null = null;

  for (const candidate of candidates) {
    if (isNaN(candidate.timestamp.getTime()) || seasonOf(candidate.timestamp) !== season) continue;
    if (resolveProductSelection(candidate.productSelection) !== productType) continue;
    if (parseUnitPrice(candidate.productSelection) === null) continue;

    const distance = Math.abs(candidate.timestamp.getTime() - target);
    if (best === null || distance < best.distance) {
      best = { selection: candidate.productSelection, distance };
    }
  }
  return best ? best.selection : null;
}
