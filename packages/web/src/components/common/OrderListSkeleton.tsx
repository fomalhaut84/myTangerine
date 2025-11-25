/**
 * 주문 목록 스켈레톤 로더
 */

import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/common/Card';

export function OrderListSkeleton() {
  return (
    <Card title="주문 목록">
      <div className="space-y-4">
        {/* 검색 및 필터 영역 */}
        <div className="flex gap-4">
          <Skeleton className="h-10 flex-1" />
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-10 w-32" />
        </div>

        {/* 테이블 헤더 */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="grid grid-cols-7 gap-4 p-4 bg-gray-50 dark:bg-gray-800">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-16" />
          </div>

          {/* 테이블 행들 */}
          {Array.from({ length: 10 }).map((_, index) => (
            <div
              key={index}
              className="grid grid-cols-7 gap-4 p-4 border-t border-gray-200 dark:border-gray-700"
            >
              <Skeleton className="h-5 w-12" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          ))}
        </div>

        {/* 페이지네이션 */}
        <div className="flex justify-center gap-2">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-10 w-10" />
        </div>
      </div>
    </Card>
  );
}
