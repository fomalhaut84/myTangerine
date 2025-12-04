/**
 * TanStack Query 키 정의
 */

import type { StatsQueryParams } from '@/types/api';

export const queryKeys = {
  orders: {
    all: ['orders'] as const,
    list: () => [...queryKeys.orders.all, 'list'] as const,
    summary: () => [...queryKeys.orders.all, 'summary'] as const,
    monthlyStats: () => [...queryKeys.orders.all, 'stats', 'monthly'] as const,
    stats: (params?: StatsQueryParams) => [...queryKeys.orders.all, 'stats', params] as const,
  },
  labels: {
    all: ['labels'] as const,
    text: () => [...queryKeys.labels.all, 'text'] as const,
    grouped: () => [...queryKeys.labels.all, 'grouped'] as const,
  },
} as const;
