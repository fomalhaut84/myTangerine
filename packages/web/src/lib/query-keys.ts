/**
 * TanStack Query 키 정의
 */

import type { StatsQueryParams } from '@/types/api';
import type { OrderStatusFilter } from '@/lib/api-client';

export const queryKeys = {
  orders: {
    all: ['orders'] as const,
    list: () => [...queryKeys.orders.all, 'list'] as const,
    detail: () => [...queryKeys.orders.all, 'detail'] as const,
    summary: () => [...queryKeys.orders.all, 'summary'] as const,
    monthlyStats: () => [...queryKeys.orders.all, 'stats', 'monthly'] as const,
    stats: (params?: StatsQueryParams) => [...queryKeys.orders.all, 'stats', params] as const,
    // Phase 2: 변경 이력 + 충돌 감지
    history: (rowNumber: number) => [...queryKeys.orders.all, 'history', rowNumber] as const,
    conflicts: () => [...queryKeys.orders.all, 'conflicts'] as const,
  },
  labels: {
    all: ['labels'] as const,
    text: (status?: OrderStatusFilter) => [...queryKeys.labels.all, 'text', status] as const,
    grouped: (status?: OrderStatusFilter) => [...queryKeys.labels.all, 'grouped', status] as const,
  },
} as const;
