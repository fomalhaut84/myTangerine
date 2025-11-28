/**
 * 완료 주문 통계 컴포넌트
 */

'use client';

import { useState } from 'react';
import { useOrderStats } from '@/hooks/use-stats';
import { KPICard } from '@/components/stats/KPICard';
import { LineChartStats } from '@/components/stats/LineChartStats';
import { DonutChartStats } from '@/components/stats/DonutChartStats';
import { Card } from '@/components/common/Card';
import type { StatsMetric, StatsRange } from '@/types/api';

export function CompletedOrdersStats() {
  const [range, setRange] = useState<StatsRange>('12m');
  const [metric, setMetric] = useState<StatsMetric>('quantity');

  const { data, isLoading, error, isFetching } = useOrderStats({
    scope: 'completed',
    range,
    metric,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">완료 주문 통계</h2>
        <div className="animate-pulse">
          <div className="h-32 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <div className="text-red-600">
          통계 데이터를 불러오는 중 오류가 발생했습니다.
        </div>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  const { summary, series, totalsByProduct } = data;

  return (
    <div className="space-y-6">
      {/* 헤더 및 필터 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold text-gray-900">완료 주문 통계</h2>
          {isFetching && !isLoading && (
            <div className="animate-spin h-5 w-5 border-2 border-blue-600 rounded-full border-t-transparent"></div>
          )}
        </div>
        <div className="flex gap-2">
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as StatsRange)}
            disabled={isFetching}
            className="px-4 py-2 border border-gray-300 rounded-lg bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="6m">최근 6개월</option>
            <option value="12m">최근 12개월</option>
          </select>
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as StatsMetric)}
            disabled={isFetching}
            className="px-4 py-2 border border-gray-300 rounded-lg bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="quantity">수량 기준</option>
            <option value="amount">금액 기준</option>
          </select>
        </div>
      </div>

      {/* KPI 카드들 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="총 매출"
          value={summary.totalRevenue}
          unit="원"
          variant="primary"
        />
        <KPICard
          title="평균 주문 금액"
          value={summary.avgOrderAmount}
          unit="원"
          variant="default"
        />
        <KPICard
          title="5kg 주문"
          value={summary.total5kgQty}
          unit="박스"
          subtitle={`${summary.total5kgAmount.toLocaleString()}원`}
          variant="warning"
        />
        <KPICard
          title="10kg 주문"
          value={summary.total10kgQty}
          unit="박스"
          subtitle={`${summary.total10kgAmount.toLocaleString()}원`}
          variant="success"
        />
      </div>

      {/* 차트 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <LineChartStats data={series} metric={metric} />
        {totalsByProduct.length > 0 && (
          <DonutChartStats data={totalsByProduct} metric={metric} />
        )}
      </div>

      {/* 기간 표시 */}
      <div className="text-sm text-gray-500 text-center">
        데이터 기간: {summary.dateRange.start} ~ {summary.dateRange.end}
      </div>
    </div>
  );
}
