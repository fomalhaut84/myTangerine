/**
 * 대시보드 스켈레톤 로더
 */

'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/common/Card';

export function SummaryCardSkeleton() {
  return (
    <Card title="주문 요약">
      <div className="space-y-6">
        {/* 통계 항목들 */}
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </div>
    </Card>
  );
}

export function RecentOrdersSkeleton() {
  return (
    <Card title="최근 주문">
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="flex items-center justify-between p-4 rounded-lg border border-gray-200"
          >
            <div className="space-y-2 flex-1">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-48" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </Card>
  );
}

const CHART_BAR_HEIGHTS = [65, 80, 55, 70, 85, 60, 75, 90, 50, 70, 65, 80];

export function ChartSkeleton({ title }: { title: string }) {
  return (
    <Card title={title}>
      <div className="h-80 flex items-center justify-center">
        <div className="w-full h-full space-y-4 p-4">
          {/* 차트 영역 */}
          <div className="flex items-end justify-around h-full gap-2">
            {CHART_BAR_HEIGHTS.map((height, index) => (
              <Skeleton
                key={index}
                className="w-full"
                style={{
                  height: `${height}%`,
                }}
              />
            ))}
          </div>
          {/* 범례 */}
          <div className="flex justify-center gap-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
      </div>
    </Card>
  );
}
