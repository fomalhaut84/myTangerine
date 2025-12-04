/**
 * 통계 관련 커스텀 훅
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import { getMonthlyStats, getOrderStats } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { StatsQueryParams } from '@/types/api';

/**
 * 월별 주문 통계 조회 훅
 */
export function useMonthlyStats() {
  return useQuery({
    queryKey: queryKeys.orders.monthlyStats(),
    queryFn: getMonthlyStats,
  });
}

/**
 * 통합 주문 통계 조회 훅
 */
export function useOrderStats(params?: StatsQueryParams, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.orders.stats(params),
    queryFn: () => getOrderStats(params),
    enabled: options?.enabled !== false,
  });
}
