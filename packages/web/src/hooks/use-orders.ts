/**
 * 주문 관련 커스텀 훅
 */

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getOrders, getOrder, getOrdersSummary, confirmOrders, confirmSingleOrder } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

/**
 * 주문 목록 조회 훅
 * @param status - 'new' (신규), 'completed' (완료), 'all' (전체)
 */
export function useOrders(status?: 'new' | 'completed' | 'all') {
  return useQuery({
    queryKey: [...queryKeys.orders.list(), status],
    queryFn: () => getOrders(status),
  });
}

/**
 * 특정 주문 조회 훅
 * @param rowNumber - 스프레드시트 행 번호
 */
export function useOrder(rowNumber: number) {
  return useQuery({
    queryKey: [...queryKeys.orders.detail(), rowNumber],
    queryFn: () => getOrder(rowNumber),
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
      // 라벨도 주문 기반이므로 갱신
      queryClient.invalidateQueries({ queryKey: queryKeys.labels.all });
    },
  });
}

/**
 * 개별 주문 확인 처리 훅
 */
export function useConfirmSingleOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (rowNumber: number) => confirmSingleOrder(rowNumber),
    onSuccess: (_, rowNumber) => {
      // 주문 목록 및 요약 갱신
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
      // 라벨도 주문 기반이므로 갱신
      queryClient.invalidateQueries({ queryKey: queryKeys.labels.all });
      // 해당 주문의 상세 데이터도 갱신 (브라우저 백 버튼 시 stale 데이터 방지)
      queryClient.invalidateQueries({ queryKey: [...queryKeys.orders.detail(), rowNumber] });
    },
  });
}
