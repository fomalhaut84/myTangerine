/**
 * 라벨 관련 커스텀 훅
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import { getLabels, getGroupedLabels, type OrderStatusFilter } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

/**
 * 라벨 텍스트 조회 훅
 */
export function useLabels(status?: OrderStatusFilter) {
  return useQuery({
    queryKey: queryKeys.labels.text(status),
    queryFn: () => getLabels(status),
  });
}

/**
 * 그룹화된 라벨 데이터 조회 훅
 */
export function useGroupedLabels(status?: OrderStatusFilter) {
  return useQuery({
    queryKey: queryKeys.labels.grouped(status),
    queryFn: () => getGroupedLabels(status),
  });
}
