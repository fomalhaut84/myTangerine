/**
 * 연도별 상품 가격 (#296 · #313 — `config.ts` 에서 옮김 · 값 변경 없음)
 *
 * 주문 타임스탬프의 달력 연도로 고른다(시즌 기준이 아니다 — 바꾸려면 별도 결정).
 * 통계 금액(api `calculateOrderAmount`)이 쓴다. 가격이 없는 상품은 금액 0 으로 집계된다.
 */
import type { ProductType } from './products.js';

/** 모든 Config 인스턴스가 같은 표를 쓴다 — 실수로 바꾸지 못하게 얼린다 */
function deepFreeze<T extends Record<string, object>>(table: T): T {
  Object.values(table).forEach((prices) => Object.freeze(prices));
  return Object.freeze(table);
}

/** 한 해의 상품 가격 — 그 해에 팔지 않은 상품은 없다 */
export type ProductPrices = Readonly<Partial<Record<ProductType, number>>>;

export type YearlyProductPrices = Readonly<Record<string, ProductPrices>>;

export const PRODUCT_PRICES_BY_YEAR: YearlyProductPrices = deepFreeze({
  '2020': { '10kg': 26000 },
  '2021': { '비상품': 17000, '10kg': 26000 },
  '2022': { '비상품': 18000, '10kg': 28000 },
  '2023': { '10kg': 30000 },
  '2024': { '5kg': 20000, '10kg': 35000 },
  '2025': { '5kg': 23000, '10kg': 38000 },
});

/** 표가 비었을 때의 마지막 대체값 */
const FALLBACK_PRICES: ProductPrices = { '5kg': 20000, '10kg': 35000 };

function sortedYears(table: YearlyProductPrices): number[] {
  return Object.keys(table)
    .map((y) => parseInt(y, 10))
    .filter((y) => !isNaN(y))
    .sort((a, b) => a - b);
}

/**
 * 그 해 가격. 없으면 가장 가까운 이전 해 → 그것도 없으면 가장 오래된 해 → 표가 비면 대체값
 */
export function pricesForYear(year: number, table: YearlyProductPrices = PRODUCT_PRICES_BY_YEAR): ProductPrices {
  const exact = table[String(year)];
  if (exact) return exact;

  const years = sortedYears(table);
  const previous = years.filter((y) => y <= year).at(-1);
  if (previous !== undefined) return table[String(previous)];

  const oldest = years.at(0);
  return oldest !== undefined ? table[String(oldest)] : FALLBACK_PRICES;
}
