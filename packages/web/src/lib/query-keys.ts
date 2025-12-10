/**
 * TanStack Query 키 정의
 */

import type { StatsQueryParams } from '@/types/api';

export const queryKeys = {
  orders: {
    all: ['orders'] as const,
    list: () => [...queryKeys.orders.all, 'list'] as const,
    detail: () => [...queryKeys.orders.all, 'detail'] as const,
    summary: () => [...queryKeys.orders.all, 'summary'] as const,
    monthlyStats: () => [...queryKeys.orders.all, 'stats', 'monthly'] as const,
    stats: (params?: StatsQueryParams) => [...queryKeys.orders.all, 'stats', params] as const,
  },
  labels: {
    all: ['labels'] as const,
    text: (status?: 'new' | 'completed' | 'all') => [...queryKeys.labels.all, 'text', status] as const,
    grouped: (status?: 'new' | 'completed' | 'all') => [...queryKeys.labels.all, 'grouped', status] as const,
  },
} as const;
