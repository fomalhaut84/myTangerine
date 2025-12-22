/**
 * 주문 변경 이력 관련 훅 (Phase 2)
 */

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getOrderHistory,
  getConflicts,
  resolveConflict,
} from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

/**
 * 주문 변경 이력 조회 훅
 * @param rowNumber - 스프레드시트 행 번호
 * @param options - 추가 옵션 (enabled, limit, offset)
 */
export function useOrderHistory(
  rowNumber: number,
  options?: { enabled?: boolean; limit?: number; offset?: number }
) {
  return useQuery({
    // 포함 limit/offset을 키에 포함하여 pagination 변경 시 refetch
    queryKey: [...queryKeys.orders.history(rowNumber), options?.limit, options?.offset],
    queryFn: () => getOrderHistory(rowNumber, options?.limit, options?.offset),
    enabled: options?.enabled ?? true,
  });
}

/**
 * 충돌 목록 조회 훅
 * @param options - 필터 및 페이지네이션 옵션
 */
export function useConflicts(options?: {
  enabled?: boolean;
  resolved?: 'true' | 'false' | 'all';
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    // 포함 resolved, limit, offset을 키에 포함하여 필터/pagination 변경 시 refetch
    queryKey: [...queryKeys.orders.conflicts(), options?.resolved, options?.limit, options?.offset],
    queryFn: () => getConflicts(options?.resolved, options?.limit, options?.offset),
    enabled: options?.enabled ?? true,
  });
}

/**
 * 충돌 해결 훅
 */
export function useResolveConflict() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      conflictId,
      resolution,
    }: {
      conflictId: number;
      resolution: 'db_wins' | 'sheet_wins' | 'manual';
    }) => resolveConflict(conflictId, resolution),
    onSuccess: () => {
      // 충돌 목록 갱신
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.conflicts() });
    },
  });
}
