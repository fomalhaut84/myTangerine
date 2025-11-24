/**
 * TanStack Query 키 정의
 */

export const queryKeys = {
  orders: {
    all: ['orders'] as const,
    list: () => [...queryKeys.orders.all, 'list'] as const,
    summary: () => [...queryKeys.orders.all, 'summary'] as const,
    monthlyStats: () => [...queryKeys.orders.all, 'stats', 'monthly'] as const,
  },
  labels: {
    all: ['labels'] as const,
    text: () => [...queryKeys.labels.all, 'text'] as const,
  },
} as const;
