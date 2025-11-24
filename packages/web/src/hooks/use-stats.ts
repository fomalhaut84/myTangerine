/**
 * 통계 관련 커스텀 훅
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import { getMonthlyStats } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

/**
 * 월별 주문 통계 조회 훅
 */
export function useMonthlyStats() {
  return useQuery({
    queryKey: queryKeys.orders.monthlyStats(),
    queryFn: getMonthlyStats,
  });
}
