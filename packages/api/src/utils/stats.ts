/**
 * 주문 통계 계산 유틸리티
 */

import type { Order, ProductType } from '@mytangerine/core';
import type { Config } from '@mytangerine/core';

/**
 * 통계 조회 범위
 */
export type StatsScope = 'completed' | 'new' | 'all';

/**
 * 기간 범위
 */
export type StatsRange = '6m' | '12m' | 'custom';

/**
 * 그룹화 단위
 */
export type StatsGrouping = 'monthly' | 'weekly';

/**
 * 측정 지표
 */
export type StatsMetric = 'quantity' | 'amount';

/**
 * 월별 통계 데이터
 */
export interface MonthlyStats {
  period: string; // YYYY-MM 형식
  total5kgQty: number;
  total10kgQty: number;
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
  total5kgQty: number;
  total10kgQty: number;
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
 * 통계 응답 데이터
 */
export interface StatsResponse {
  success: true;
  filters: {
    scope: StatsScope;
    range: StatsRange;
    grouping: StatsGrouping;
    metric: StatsMetric;
  };
  summary: StatsSummary;
  series: MonthlyStats[];
  totalsByProduct: ProductTotals[];
  meta: {
    generatedAt: string;
    currency: 'KRW';
  };
}

/**
 * 주문 금액 계산
 */
export function calculateOrderAmount(order: Order, config: Config): number {
  if (!order.productType) {
    return 0;
  }
  const price = config.productPrices[order.productType];
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
 */
export function calculateMonthlyStats(
  month: string,
  orders: Order[],
  config: Config,
  previousMonthRevenue: number | null
): MonthlyStats {
  let total5kgQty = 0;
  let total10kgQty = 0;
  let total5kgAmount = 0;
  let total10kgAmount = 0;
  let totalRevenue = 0;

  for (const order of orders) {
    const amount = calculateOrderAmount(order, config);
    totalRevenue += amount;

    if (order.productType === '5kg') {
      total5kgQty += order.quantity;
      total5kgAmount += amount;
    } else if (order.productType === '10kg') {
      total10kgQty += order.quantity;
      total10kgAmount += amount;
    }
  }

  const orderCount = orders.length;
  const avgOrderAmount = orderCount > 0 ? totalRevenue / orderCount : 0;

  // 전월 대비 증감률 계산
  let momGrowthPct: number | null = null;
  if (previousMonthRevenue !== null && previousMonthRevenue > 0) {
    momGrowthPct = ((totalRevenue - previousMonthRevenue) / previousMonthRevenue) * 100;
  }

  return {
    period: month,
    total5kgQty,
    total10kgQty,
    total5kgAmount,
    total10kgAmount,
    orderCount,
    avgOrderAmount: Math.round(avgOrderAmount),
    momGrowthPct: momGrowthPct !== null ? Math.round(momGrowthPct * 100) / 100 : null,
  };
}

/**
 * 상품별 합계 및 비율 계산
 */
export function calculateProductTotals(orders: Order[], config: Config): ProductTotals[] {
  let total5kgQty = 0;
  let total10kgQty = 0;
  let total5kgAmount = 0;
  let total10kgAmount = 0;

  for (const order of orders) {
    const amount = calculateOrderAmount(order, config);

    if (order.productType === '5kg') {
      total5kgQty += order.quantity;
      total5kgAmount += amount;
    } else if (order.productType === '10kg') {
      total10kgQty += order.quantity;
      total10kgAmount += amount;
    }
  }

  const totalQty = total5kgQty + total10kgQty;
  const totalRevenue = total5kgAmount + total10kgAmount;

  const result: ProductTotals[] = [];

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
  let total5kgQty = 0;
  let total10kgQty = 0;
  let total5kgAmount = 0;
  let total10kgAmount = 0;

  for (const order of orders) {
    const amount = calculateOrderAmount(order, config);

    if (order.productType === '5kg') {
      total5kgQty += order.quantity;
      total5kgAmount += amount;
    } else if (order.productType === '10kg') {
      total10kgQty += order.quantity;
      total10kgAmount += amount;
    }
  }

  const totalRevenue = total5kgAmount + total10kgAmount;
  const avgOrderAmount = orders.length > 0 ? totalRevenue / orders.length : 0;

  return {
    total5kgQty,
    total10kgQty,
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
 */
export function calculateDateRange(range: StatsRange, customStart?: Date, customEnd?: Date): { start: Date; end: Date } {
  let end = customEnd || new Date();

  // Custom range인 경우 end date를 해당 날짜의 마지막 시간으로 설정
  if (range === 'custom' && customEnd) {
    end = new Date(customEnd);
    end.setHours(23, 59, 59, 999);
  }

  let start: Date;
  if (range === 'custom' && customStart) {
    start = new Date(customStart);
    start.setHours(0, 0, 0, 0);
  } else if (range === '6m') {
    start = new Date(end);
    start.setMonth(start.getMonth() - 6);
  } else {
    // 12m (기본값)
    start = new Date(end);
    start.setMonth(start.getMonth() - 12);
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
    customStart?: Date;
    customEnd?: Date;
  }
): StatsResponse {
  const { scope, range, grouping, metric, customStart, customEnd } = options;

  // 날짜 범위 계산
  const { start, end } = calculateDateRange(range, customStart, customEnd);

  // 날짜 범위 내의 주문 필터링
  const filteredOrders = filterOrdersByDateRange(orders, start, end);

  // 월별 그룹화
  const groupedByMonth = groupByMonth(filteredOrders);

  // 월별 정렬 (오래된 순)
  const sortedMonths = Array.from(groupedByMonth.keys()).sort();

  // 월별 통계 계산
  const series: MonthlyStats[] = [];
  let previousMonthRevenue: number | null = null;

  for (const month of sortedMonths) {
    const monthOrders = groupedByMonth.get(month)!;
    const monthStats = calculateMonthlyStats(month, monthOrders, config, previousMonthRevenue);
    series.push(monthStats);

    // 다음 달의 증감률 계산을 위해 현재 달의 매출 저장
    previousMonthRevenue = monthStats.total5kgAmount + monthStats.total10kgAmount;
  }

  // 통계 요약 (한 번의 루프로 summary와 totalsByProduct 동시 계산)
  let total5kgQty = 0;
  let total10kgQty = 0;
  let total5kgAmount = 0;
  let total10kgAmount = 0;

  for (const order of filteredOrders) {
    const amount = calculateOrderAmount(order, config);

    if (order.productType === '5kg') {
      total5kgQty += order.quantity;
      total5kgAmount += amount;
    } else if (order.productType === '10kg') {
      total10kgQty += order.quantity;
      total10kgAmount += amount;
    }
  }

  const totalRevenue = total5kgAmount + total10kgAmount;
  const avgOrderAmount = filteredOrders.length > 0 ? totalRevenue / filteredOrders.length : 0;

  const summary: StatsSummary = {
    total5kgQty,
    total10kgQty,
    total5kgAmount,
    total10kgAmount,
    totalRevenue,
    avgOrderAmount: Math.round(avgOrderAmount),
    dateRange: {
      start: formatLocalDate(start),
      end: formatLocalDate(end),
    },
  };

  // 상품별 합계 및 비율
  const totalQty = total5kgQty + total10kgQty;
  const totalsByProduct: ProductTotals[] = [];

  if (total5kgQty > 0) {
    totalsByProduct.push({
      productType: '5kg',
      quantity: total5kgQty,
      amount: total5kgAmount,
      quantityPct: totalQty > 0 ? Math.round((total5kgQty / totalQty) * 10000) / 100 : 0,
      revenuePct: totalRevenue > 0 ? Math.round((total5kgAmount / totalRevenue) * 10000) / 100 : 0,
    });
  }

  if (total10kgQty > 0) {
    totalsByProduct.push({
      productType: '10kg',
      quantity: total10kgQty,
      amount: total10kgAmount,
      quantityPct: totalQty > 0 ? Math.round((total10kgQty / totalQty) * 10000) / 100 : 0,
      revenuePct: totalRevenue > 0 ? Math.round((total10kgAmount / totalRevenue) * 10000) / 100 : 0,
    });
  }

  return {
    success: true,
    filters: {
      scope,
      range,
      grouping,
      metric,
    },
    summary,
    series,
    totalsByProduct,
    meta: {
      generatedAt: new Date().toISOString(),
      currency: 'KRW',
    },
  };
}
