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
 * - staleTime: 5분 (탭 전환 시 캐시된 데이터 즉시 표시)
 * - gcTime: 30분 (가비지 컬렉션 시간)
 */
export function useOrderStats(params?: StatsQueryParams, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.orders.stats(params),
    queryFn: () => getOrderStats(params),
    enabled: options?.enabled !== false,
    staleTime: 5 * 60 * 1000, // 5분
    gcTime: 30 * 60 * 1000, // 30분
  });
}
