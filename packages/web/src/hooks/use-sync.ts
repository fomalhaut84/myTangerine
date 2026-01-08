/**
 * 데이터 동기화 관련 커스텀 훅
 */

'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { syncData } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

/**
 * 수동 데이터 동기화 훅
 * Google Sheets → PostgreSQL 동기화 실행
 */
export function useSyncData() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: syncData,
    onSuccess: () => {
      // 동기화 후 모든 주문 관련 캐시 무효화
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.labels.all });
    },
  });
}
