/**
 * 주문 관련 커스텀 훅
 */

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getOrders,
  getOrder,
  getOrdersSummary,
  confirmOrders,
  confirmSingleOrder,
  confirmPayment,
  markDelivered,
  deleteOrder,
  restoreOrder,
  getDeletedOrders,
  type OrderStatusFilter,
} from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

/**
 * 주문 목록 조회 훅
 * @param status - 'new' (신규), 'pending_payment' (입금확인), 'completed' (배송완료), 'all' (전체)
 */
export function useOrders(status?: OrderStatusFilter) {
  return useQuery({
    queryKey: [...queryKeys.orders.list(), status],
    queryFn: () => getOrders(status),
  });
}

/**
 * 특정 주문 조회 훅
 * @param rowNumber - 스프레드시트 행 번호
 * @param options - 추가 옵션 (enabled 등)
 */
export function useOrder(rowNumber: number, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: [...queryKeys.orders.detail(), rowNumber],
    queryFn: () => getOrder(rowNumber),
    enabled: options?.enabled ?? true,
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

/**
 * 입금 확인 처리 훅 (신규주문 → 입금확인)
 */
export function useConfirmPayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (rowNumber: number) => confirmPayment(rowNumber),
    onSuccess: (_, rowNumber) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.labels.all });
      queryClient.invalidateQueries({ queryKey: [...queryKeys.orders.detail(), rowNumber] });
    },
  });
}

/**
 * 배송 완료 처리 훅 (입금확인 → 배송완료)
 */
export function useMarkDelivered() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ rowNumber, trackingNumber }: { rowNumber: number; trackingNumber?: string }) =>
      markDelivered(rowNumber, trackingNumber),
    onSuccess: (_, { rowNumber }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.labels.all });
      queryClient.invalidateQueries({ queryKey: [...queryKeys.orders.detail(), rowNumber] });
    },
  });
}

/**
 * 주문 삭제 훅 (Soft Delete)
 */
export function useDeleteOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (rowNumber: number) => deleteOrder(rowNumber),
    onSuccess: (_, rowNumber) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.labels.all });
      queryClient.invalidateQueries({ queryKey: [...queryKeys.orders.detail(), rowNumber] });
    },
  });
}

/**
 * 주문 복원 훅 (Soft Delete 취소)
 */
export function useRestoreOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (rowNumber: number) => restoreOrder(rowNumber),
    onSuccess: (_, rowNumber) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.labels.all });
      queryClient.invalidateQueries({ queryKey: [...queryKeys.orders.detail(), rowNumber] });
    },
  });
}

/**
 * 삭제된 주문 목록 조회 훅
 * @param options - 추가 옵션 (enabled 등)
 */
export function useDeletedOrders(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: [...queryKeys.orders.list(), 'deleted'],
    queryFn: getDeletedOrders,
    enabled: options?.enabled ?? true,
  });
}
