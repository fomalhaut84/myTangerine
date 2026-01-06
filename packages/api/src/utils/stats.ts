/**
 * 주문 통계 계산 유틸리티
 */

import type { Order, ProductType, OrderType } from '@mytangerine/core';
import type { Config } from '@mytangerine/core';

/**
 * 통계 조회 범위
 * - 'completed': 배송완료 주문
 * - 'new': 신규주문
 * - 'pending_payment': 입금확인 주문 (Issue #130)
 * - 'all': 전체 주문
 * - 'peak_season': 성수기 주문 (10~2월) - Issue #142
 * - 'off_season': 비수기 주문 (3~9월) - Issue #142
 */
export type StatsScope = 'completed' | 'new' | 'pending_payment' | 'all' | 'peak_season' | 'off_season';

/**
 * 성수기 월 (10월~2월)
 * Issue #142: Seasonal scope
 */
export const PEAK_SEASON_MONTHS = [10, 11, 12, 1, 2];

/**
 * 비수기 월 (3월~9월)
 * Issue #142: Seasonal scope
 */
export const OFF_SEASON_MONTHS = [3, 4, 5, 6, 7, 8, 9];

/**
 * 기간 범위
 */
export type StatsRange = '6m' | '12m' | 'custom';

/**
 * 그룹화 단위
 */
export type StatsGrouping = 'monthly';

/**
 * 측정 지표
 */
export type StatsMetric = 'quantity' | 'amount';

/**
 * 주문 유형 필터
 * - 'all': 전체 주문
 * - 'customer': 고객 주문만 (판매)
 * - 'gift': 선물 주문만
 * - 'claim': 배송사고 주문만 (Issue #152)
 * OrderType에서 파생하여 타입 일관성 유지
 */
export type OrderTypeFilter = OrderType | 'all';

/**
 * 매출에 포함되는 주문 유형인지 확인
 * - customer: 매출 포함
 * - gift, claim: 매출 제외
 * Issue #152: 배송사고(claim) 추가
 */
export function isRevenueIncludedOrderType(orderType: OrderType): boolean {
  return orderType === 'customer';
}

/**
 * 월별 통계 데이터
 */
export interface MonthlyStats {
  period: string; // YYYY-MM 형식
  totalNonProductQty: number;
  total5kgQty: number;
  total10kgQty: number;
  totalNonProductAmount: number;
  total5kgAmount: number;
  total10kgAmount: number;
  orderCount: number;
  avgOrderAmount: number;
  momGrowthPct: number | null; // 전월 대비 증감률
}

/**
 * 상품별 합계
 */
export interface ProductTotals {
  productType: ProductType;
  quantity: number;
  amount: number;
  quantityPct: number; // 수량 비율 (%)
  revenuePct: number; // 매출 비율 (%)
}

/**
 * 통계 요약
 */
export interface StatsSummary {
  orderCount: number;
  totalNonProductQty: number;
  total5kgQty: number;
  total10kgQty: number;
  totalNonProductAmount: number;
  total5kgAmount: number;
  total10kgAmount: number;
  totalRevenue: number;
  avgOrderAmount: number;
  dateRange: {
    start: string; // YYYY-MM-DD
    end: string; // YYYY-MM-DD
  };
}

/**
 * 섹션별 통계 (전체/판매/선물)
 */
export interface StatsSections {
  /** 전체 주문 통계 */
  overall: StatsSummary;
  /** 판매 주문 통계 (고객 주문만, 매출 계산에 사용) */
  sales: StatsSummary;
  /** 선물 주문 통계 (매출에서 제외) */
  gifts: StatsSummary;
}

/**
 * 통계 응답 데이터
 */
export interface StatsResponse {
  success: true;
  filters: {
    scope: StatsScope;
    range: StatsRange;
    grouping: StatsGrouping;
    metric: StatsMetric;
    orderType: OrderTypeFilter;
  };
  /** 현재 필터에 해당하는 요약 (하위 호환성) */
  summary: StatsSummary;
  /** 섹션별 통계 (전체/판매/선물) */
  sections: StatsSections;
  series: MonthlyStats[];
  totalsByProduct: ProductTotals[];
  meta: {
    generatedAt: string;
    currency: 'KRW';
  };
}

/**
 * 주문 금액 계산 (년도별 가격 적용)
 */
export function calculateOrderAmount(order: Order, config: Config): number {
  if (!order.productType) {
    return 0;
  }

  // 주문 년도 추출
  const orderYear = order.timestamp.getFullYear();

  // 해당 년도 가격 조회
  const prices = config.getPricesForYear(orderYear);
  const price = prices[order.productType];

  // 가격이 정의되지 않은 경우 0 반환 (예: 2024년 이후 비상품)
  if (price === undefined) {
    return 0;
  }

  return price * order.quantity;
}

/**
 * 주문을 월별로 그룹화 (local time 기준)
 */
export function groupByMonth(orders: Order[]): Map<string, Order[]> {
  const grouped = new Map<string, Order[]>();

  for (const order of orders) {
    // Local time 기준으로 YYYY-MM 형식 추출
    const year = order.timestamp.getFullYear();
    const month = String(order.timestamp.getMonth() + 1).padStart(2, '0');
    const monthKey = `${year}-${month}`;

    if (!grouped.has(monthKey)) {
      grouped.set(monthKey, []);
    }
    grouped.get(monthKey)!.push(order);
  }

  return grouped;
}

/**
 * 월별 통계 계산
 * @param options.excludeGiftRevenue - true인 경우 gift 주문의 매출을 제외
 * @param options.zeroRevenue - true인 경우 모든 매출을 0으로 반환
 */
export function calculateMonthlyStats(
  month: string,
  orders: Order[],
  config: Config,
  previousMonthRevenue: number | null,
  options?: { excludeGiftRevenue?: boolean; zeroRevenue?: boolean }
): MonthlyStats {
  const { excludeGiftRevenue = false, zeroRevenue = false } = options || {};

  let totalNonProductQty = 0;
  let total5kgQty = 0;
  let total10kgQty = 0;
  let totalNonProductAmount = 0;
  let total5kgAmount = 0;
  let total10kgAmount = 0;

  for (const order of orders) {
    // 수량은 항상 집계
    if (order.productType === '비상품') {
      totalNonProductQty += order.quantity;
    } else if (order.productType === '5kg') {
      total5kgQty += order.quantity;
    } else if (order.productType === '10kg') {
      total10kgQty += order.quantity;
    }

    // 매출 계산: 비판매 주문(gift/claim) 제외 옵션 또는 전체 매출 0 옵션 적용
    if (!zeroRevenue) {
      const shouldIncludeRevenue = !excludeGiftRevenue || isRevenueIncludedOrderType(order.orderType);
      if (shouldIncludeRevenue) {
        const amount = calculateOrderAmount(order, config);
        if (order.productType === '비상품') {
          totalNonProductAmount += amount;
        } else if (order.productType === '5kg') {
          total5kgAmount += amount;
        } else if (order.productType === '10kg') {
          total10kgAmount += amount;
        }
      }
    }
  }

  const totalRevenue = totalNonProductAmount + total5kgAmount + total10kgAmount;
  // 평균 주문 금액은 매출이 포함된 주문 기준으로 계산
  const revenueOrderCount = excludeGiftRevenue
    ? orders.filter(o => isRevenueIncludedOrderType(o.orderType)).length
    : orders.length;
  const avgOrderAmount = revenueOrderCount > 0 ? totalRevenue / revenueOrderCount : 0;

  // 전월 대비 증감률 계산
  let momGrowthPct: number | null = null;
  if (previousMonthRevenue !== null && previousMonthRevenue > 0) {
    momGrowthPct = ((totalRevenue - previousMonthRevenue) / previousMonthRevenue) * 100;
  }

  return {
    period: month,
    totalNonProductQty,
    total5kgQty,
    total10kgQty,
    totalNonProductAmount,
    total5kgAmount,
    total10kgAmount,
    orderCount: orders.length,
    avgOrderAmount: Math.round(avgOrderAmount),
    momGrowthPct: momGrowthPct !== null ? Math.round(momGrowthPct * 100) / 100 : null,
  };
}

/**
 * 상품별 합계 및 비율 계산
 * @param options.excludeGiftRevenue - true인 경우 gift 주문의 매출을 제외
 * @param options.zeroRevenue - true인 경우 모든 매출을 0으로 반환
 */
export function calculateProductTotals(
  orders: Order[],
  config: Config,
  options?: { excludeGiftRevenue?: boolean; zeroRevenue?: boolean }
): ProductTotals[] {
  const { excludeGiftRevenue = false, zeroRevenue = false } = options || {};

  let totalNonProductQty = 0;
  let total5kgQty = 0;
  let total10kgQty = 0;
  let totalNonProductAmount = 0;
  let total5kgAmount = 0;
  let total10kgAmount = 0;

  for (const order of orders) {
    // 수량은 항상 집계
    if (order.productType === '비상품') {
      totalNonProductQty += order.quantity;
    } else if (order.productType === '5kg') {
      total5kgQty += order.quantity;
    } else if (order.productType === '10kg') {
      total10kgQty += order.quantity;
    }

    // 매출 계산: 비판매 주문(gift/claim) 제외 옵션 또는 전체 매출 0 옵션 적용
    if (!zeroRevenue) {
      const shouldIncludeRevenue = !excludeGiftRevenue || isRevenueIncludedOrderType(order.orderType);
      if (shouldIncludeRevenue) {
        const amount = calculateOrderAmount(order, config);
        if (order.productType === '비상품') {
          totalNonProductAmount += amount;
        } else if (order.productType === '5kg') {
          total5kgAmount += amount;
        } else if (order.productType === '10kg') {
          total10kgAmount += amount;
        }
      }
    }
  }

  const totalQty = totalNonProductQty + total5kgQty + total10kgQty;
  const totalRevenue = totalNonProductAmount + total5kgAmount + total10kgAmount;

  const result: ProductTotals[] = [];

  if (totalNonProductQty > 0) {
    result.push({
      productType: '비상품',
      quantity: totalNonProductQty,
      amount: totalNonProductAmount,
      quantityPct: totalQty > 0 ? Math.round((totalNonProductQty / totalQty) * 10000) / 100 : 0,
      revenuePct: totalRevenue > 0 ? Math.round((totalNonProductAmount / totalRevenue) * 10000) / 100 : 0,
    });
  }

  if (total5kgQty > 0) {
    result.push({
      productType: '5kg',
      quantity: total5kgQty,
      amount: total5kgAmount,
      quantityPct: totalQty > 0 ? Math.round((total5kgQty / totalQty) * 10000) / 100 : 0,
      revenuePct: totalRevenue > 0 ? Math.round((total5kgAmount / totalRevenue) * 10000) / 100 : 0,
    });
  }

  if (total10kgQty > 0) {
    result.push({
      productType: '10kg',
      quantity: total10kgQty,
      amount: total10kgAmount,
      quantityPct: totalQty > 0 ? Math.round((total10kgQty / totalQty) * 10000) / 100 : 0,
      revenuePct: totalRevenue > 0 ? Math.round((total10kgAmount / totalRevenue) * 10000) / 100 : 0,
    });
  }

  return result;
}

/**
 * 통계 요약 계산
 */
export function calculateSummary(
  orders: Order[],
  config: Config,
  startDate: Date,
  endDate: Date
): StatsSummary {
  let totalNonProductQty = 0;
  let total5kgQty = 0;
  let total10kgQty = 0;
  let totalNonProductAmount = 0;
  let total5kgAmount = 0;
  let total10kgAmount = 0;

  for (const order of orders) {
    const amount = calculateOrderAmount(order, config);

    if (order.productType === '비상품') {
      totalNonProductQty += order.quantity;
      totalNonProductAmount += amount;
    } else if (order.productType === '5kg') {
      total5kgQty += order.quantity;
      total5kgAmount += amount;
    } else if (order.productType === '10kg') {
      total10kgQty += order.quantity;
      total10kgAmount += amount;
    }
  }

  const totalRevenue = totalNonProductAmount + total5kgAmount + total10kgAmount;
  const avgOrderAmount = orders.length > 0 ? totalRevenue / orders.length : 0;

  return {
    orderCount: orders.length,
    totalNonProductQty,
    total5kgQty,
    total10kgQty,
    totalNonProductAmount,
    total5kgAmount,
    total10kgAmount,
    totalRevenue,
    avgOrderAmount: Math.round(avgOrderAmount),
    dateRange: {
      start: formatLocalDate(startDate),
      end: formatLocalDate(endDate),
    },
  };
}

/**
 * Date 객체를 local time 기준 YYYY-MM-DD 형식으로 포맷
 */
function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 날짜 범위 계산
 * - 6m/12m: 월 단위로 계산 (각 월의 1일을 기준)
 * - 예: 오늘이 2025년 12월 13일이고 12개월 선택 시
 *   - 시작: 2025년 1월 1일 (현재 달 포함 12개월)
 *   - 종료: 2025년 12월 31일 (현재 달의 마지막 날)
 * - customEnd가 전달된 경우 해당 날짜를 존중
 */
export function calculateDateRange(range: StatsRange, customStart?: Date, customEnd?: Date): { start: Date; end: Date } {
  const now = new Date();
  let end: Date;
  let start: Date;

  if (range === 'custom' && customStart && customEnd) {
    // Custom range: 사용자 지정 날짜 사용 (정확히 전달된 날짜 사용)
    start = new Date(customStart);
    start.setHours(0, 0, 0, 0);
    end = new Date(customEnd);
    end.setHours(23, 59, 59, 999);
  } else if (customEnd) {
    // customEnd가 전달된 경우 (테스트 등에서 특정 날짜 기준으로 계산)
    const baseDate = new Date(customEnd);
    end = new Date(baseDate);
    end.setHours(23, 59, 59, 999);

    // 시작일: N개월 전 월의 1일
    const monthsBack = range === '6m' ? 5 : 11;
    start = new Date(baseDate.getFullYear(), baseDate.getMonth() - monthsBack, 1, 0, 0, 0, 0);
  } else {
    // 기본: 월 단위 계산 (현재 달의 마지막 날을 종료일로 설정)
    end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // 시작일: N개월 전 월의 1일
    const monthsBack = range === '6m' ? 5 : 11; // 현재 달 포함이므로 N-1
    start = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1, 0, 0, 0, 0);
  }

  return { start, end };
}

/**
 * 날짜 범위 내의 주문 필터링
 */
export function filterOrdersByDateRange(orders: Order[], start: Date, end: Date): Order[] {
  return orders.filter(order => {
    const orderDate = order.timestamp;
    return orderDate >= start && orderDate <= end;
  });
}

/**
 * 주문유형별 필터링
 */
export function filterOrdersByOrderType(orders: Order[], orderType: OrderTypeFilter): Order[] {
  if (orderType === 'all') {
    return orders;
  }
  return orders.filter(order => order.orderType === orderType);
}

/**
 * 시즌별 필터링 (주문 타임스탬프의 월 기준)
 * Issue #142: Seasonal scope
 */
export function filterOrdersBySeason(orders: Order[], season: 'peak_season' | 'off_season'): Order[] {
  const monthsToInclude = season === 'peak_season' ? PEAK_SEASON_MONTHS : OFF_SEASON_MONTHS;
  return orders.filter(order => {
    const month = order.timestamp.getMonth() + 1; // getMonth()는 0-indexed
    return monthsToInclude.includes(month);
  });
}

/**
 * scope가 시즌 기반인지 확인
 * Issue #142: Seasonal scope
 */
export function isSeasonalScope(scope: StatsScope): scope is 'peak_season' | 'off_season' {
  return scope === 'peak_season' || scope === 'off_season';
}

/**
 * 주문 목록에서 요약 통계 계산
 * @param excludeGiftRevenue - true인 경우 gift 주문의 매출을 제외 (overall 섹션용)
 * @param zeroRevenue - true인 경우 모든 매출을 0으로 반환 (gift 섹션용)
 */
function calculateSummaryFromOrders(
  orders: Order[],
  config: Config,
  startDate: Date,
  endDate: Date,
  options?: { excludeGiftRevenue?: boolean; zeroRevenue?: boolean }
): StatsSummary {
  const { excludeGiftRevenue = false, zeroRevenue = false } = options || {};

  let totalNonProductQty = 0;
  let total5kgQty = 0;
  let total10kgQty = 0;
  let totalNonProductAmount = 0;
  let total5kgAmount = 0;
  let total10kgAmount = 0;

  for (const order of orders) {
    // 수량은 항상 집계
    if (order.productType === '비상품') {
      totalNonProductQty += order.quantity;
    } else if (order.productType === '5kg') {
      total5kgQty += order.quantity;
    } else if (order.productType === '10kg') {
      total10kgQty += order.quantity;
    }

    // 매출 계산: 비판매 주문(gift/claim) 제외 옵션 또는 전체 매출 0 옵션 적용
    if (!zeroRevenue) {
      const shouldIncludeRevenue = !excludeGiftRevenue || isRevenueIncludedOrderType(order.orderType);
      if (shouldIncludeRevenue) {
        const amount = calculateOrderAmount(order, config);
        if (order.productType === '비상품') {
          totalNonProductAmount += amount;
        } else if (order.productType === '5kg') {
          total5kgAmount += amount;
        } else if (order.productType === '10kg') {
          total10kgAmount += amount;
        }
      }
    }
  }

  const totalRevenue = totalNonProductAmount + total5kgAmount + total10kgAmount;
  // 평균 주문 금액은 매출이 포함된 주문 기준으로 계산
  const revenueOrderCount = excludeGiftRevenue
    ? orders.filter(o => isRevenueIncludedOrderType(o.orderType)).length
    : orders.length;
  const avgOrderAmount = revenueOrderCount > 0 ? totalRevenue / revenueOrderCount : 0;

  return {
    orderCount: orders.length,
    totalNonProductQty,
    total5kgQty,
    total10kgQty,
    totalNonProductAmount,
    total5kgAmount,
    total10kgAmount,
    totalRevenue,
    avgOrderAmount: Math.round(avgOrderAmount),
    dateRange: {
      start: formatLocalDate(startDate),
      end: formatLocalDate(endDate),
    },
  };
}

/**
 * 전체 통계 계산
 */
export function calculateStats(
  orders: Order[],
  config: Config,
  options: {
    scope: StatsScope;
    range: StatsRange;
    grouping: StatsGrouping;
    metric: StatsMetric;
    orderType?: OrderTypeFilter;
    customStart?: Date;
    customEnd?: Date;
  }
): StatsResponse {
  const { scope, range, grouping, metric, orderType = 'all', customStart, customEnd } = options;

  // 날짜 범위 계산
  const { start, end } = calculateDateRange(range, customStart, customEnd);

  // 날짜 범위 내의 주문 필터링
  const dateFilteredOrders = filterOrdersByDateRange(orders, start, end);

  // 섹션별 통계 계산 (전체/판매/선물)
  const overallOrders = dateFilteredOrders;
  const salesOrders = filterOrdersByOrderType(dateFilteredOrders, 'customer');
  const giftOrders = filterOrdersByOrderType(dateFilteredOrders, 'gift');

  const sections: StatsSections = {
    // overall: 전체 수량, 매출은 판매(customer)만 포함
    overall: calculateSummaryFromOrders(overallOrders, config, start, end, { excludeGiftRevenue: true }),
    // sales: 판매 주문만 (수량 + 매출)
    sales: calculateSummaryFromOrders(salesOrders, config, start, end),
    // gifts: 선물 주문만 (수량만, 매출은 0)
    gifts: calculateSummaryFromOrders(giftOrders, config, start, end, { zeroRevenue: true }),
  };

  // 현재 필터에 해당하는 주문 선택
  const filteredOrders = filterOrdersByOrderType(dateFilteredOrders, orderType);

  // 매출 처리 옵션 결정 (summary, series, totalsByProduct 모두에 적용)
  const revenueOptions = orderType === 'gift'
    ? { zeroRevenue: true }
    : orderType === 'all'
      ? { excludeGiftRevenue: true }
      : {};

  // 월별 그룹화 (필터된 주문 기준)
  const groupedByMonth = groupByMonth(filteredOrders);

  // 월별 정렬 (오래된 순)
  const sortedMonths = Array.from(groupedByMonth.keys()).sort();

  // 월별 통계 계산 (매출 옵션 적용)
  const series: MonthlyStats[] = [];
  let previousMonthRevenue: number | null = null;

  for (const month of sortedMonths) {
    const monthOrders = groupedByMonth.get(month)!;
    const monthStats = calculateMonthlyStats(month, monthOrders, config, previousMonthRevenue, revenueOptions);
    series.push(monthStats);

    // 다음 달의 증감률 계산을 위해 현재 달의 매출 저장 (비상품 포함)
    previousMonthRevenue = monthStats.totalNonProductAmount + monthStats.total5kgAmount + monthStats.total10kgAmount;
  }

  // 현재 필터에 해당하는 요약 (매출 처리 옵션 적용)
  const summary = calculateSummaryFromOrders(filteredOrders, config, start, end, revenueOptions);

  // 상품별 합계 및 비율 (필터된 주문 기준, 매출 옵션 적용)
  const totalsByProduct = calculateProductTotals(filteredOrders, config, revenueOptions);

  return {
    success: true,
    filters: {
      scope,
      range,
      grouping,
      metric,
      orderType,
    },
    summary,
    sections,
    series,
    totalsByProduct,
    meta: {
      generatedAt: new Date().toISOString(),
      currency: 'KRW',
    },
  };
}
