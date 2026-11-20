/**
 * 주문 변경 이력 관련 훅 (Phase 2)
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import { getOrderHistory } from '@/lib/api-client';
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
