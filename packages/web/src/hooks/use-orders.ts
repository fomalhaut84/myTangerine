/**
 * 주문 관련 커스텀 훅
 */

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getOrders, getOrdersSummary, confirmOrders } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

/**
 * 주문 목록 조회 훅
 */
export function useOrders() {
  return useQuery({
    queryKey: queryKeys.orders.list(),
    queryFn: getOrders,
  });
}

/**
 * 주문 요약 조회 훅
 */
export function useOrdersSummary() {
  return useQuery({
    queryKey: queryKeys.orders.summary(),
    queryFn: getOrdersSummary,
  });
}

/**
 * 주문 확인 처리 훅
 */
export function useConfirmOrders() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: confirmOrders,
    onSuccess: () => {
      // 주문 목록 및 요약 갱신
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
    },
  });
}
