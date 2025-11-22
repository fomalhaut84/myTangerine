/**
 * 라벨 관련 커스텀 훅
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import { getLabels } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

/**
 * 라벨 텍스트 조회 훅
 */
export function useLabels() {
  return useQuery({
    queryKey: queryKeys.labels.text(),
    queryFn: getLabels,
  });
}
