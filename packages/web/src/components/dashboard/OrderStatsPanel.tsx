/**
 * 주문 통계 패널 컴포넌트 (범용)
 * scope에 따라 신규/완료/전체 주문 통계를 표시
 * Issue #134: 모바일 반응형 UI 개선
 */

'use client';

import { useState } from 'react';
import { useOrderStats } from '@/hooks/use-stats';
import { KPICard } from '@/components/stats/KPICard';
import { LineChartStats } from '@/components/stats/LineChartStats';
import { DonutChartStats } from '@/components/stats/DonutChartStats';
import { BarChartStats } from '@/components/stats/BarChartStats';
import { Card } from '@/components/common/Card';
import { formatDateRangeKorean } from '@/lib/utils';
import type { StatsMetric, StatsRange, StatsScope } from '@/types/api';

interface OrderStatsPanelProps {
  /** 패널 제목 */
  title: string;
  /** 주문 범위 (new: 신규, pending_payment: 입금확인, completed: 완료, all: 전체, peak_season: 성수기, off_season: 비수기) */
  scope: StatsScope;
  /** 차트 표시 여부 (기본: true) */
  showCharts?: boolean;
  /** 선물 통계 표시 여부 */
  showGiftStats?: boolean;
  /** 컴팩트 모드 (차트 간소화) */
  compact?: boolean;
}

export function OrderStatsPanel({
  title,
  scope,
  showCharts = true,
  showGiftStats = false,
  compact = false,
}: OrderStatsPanelProps) {
  const [range, setRange] = useState<StatsRange>('12m');
  const [metric, setMetric] = useState<StatsMetric>('quantity');

  const { data, isLoading, error, isFetching } = useOrderStats({
    scope,
    range,
    metric,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-gray-900">{title}</h2>
        <div className="animate-pulse">
          <div className="h-32 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Card title={title}>
        <div className="text-red-600">
          {title} 데이터를 불러오는 중 오류가 발생했습니다.
        </div>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  const { summary, sections, series, totalsByProduct } = data;

  // 선물 비율 계산
  const giftRatio = sections && sections.overall.orderCount > 0
    ? Math.round((sections.gifts.orderCount / sections.overall.orderCount) * 100)
    : 0;

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* 헤더 및 필터 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-3">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900">{title}</h2>
          {showGiftStats && giftRatio > 0 && (
            <span className="px-2 py-1 text-xs font-medium bg-purple-100 text-purple-700 rounded-full">
              선물 {giftRatio}%
            </span>
          )}
          {isFetching && !isLoading && (
            <div className="animate-spin h-4 w-4 border-2 border-blue-600 rounded-full border-t-transparent"></div>
          )}
        </div>
        <div className="flex gap-2">
          <select
            value={range}
            onChange={(e) => {
              const value = e.target.value;
              if (value === '6m' || value === '12m') {
                setRange(value);
              }
            }}
            disabled={isFetching}
            aria-label="조회 기간 선택"
            className="px-2 sm:px-3 py-1.5 border border-gray-300 rounded-lg bg-white text-xs sm:text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <option value="6m">6개월</option>
            <option value="12m">12개월</option>
          </select>
          <select
            value={metric}
            onChange={(e) => {
              const value = e.target.value;
              if (value === 'quantity' || value === 'amount') {
                setMetric(value);
              }
            }}
            disabled={isFetching}
            aria-label="조회 지표 선택"
            className="px-2 sm:px-3 py-1.5 border border-gray-300 rounded-lg bg-white text-xs sm:text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <option value="quantity">수량</option>
            <option value="amount">금액</option>
          </select>
        </div>
      </div>

      {/* KPI 카드들 */}
      <div className={`grid gap-2 sm:gap-3 ${compact ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'}`}>
        <KPICard
          title="총 매출"
          value={summary.totalRevenue}
          unit="원"
          variant="primary"
        />
        <KPICard
          title="주문 수"
          value={summary.orderCount}
          unit="건"
          variant="default"
        />
        {!compact && (
          <>
            <KPICard
              title="5kg"
              value={summary.total5kgQty}
              unit="박스"
              subtitle={`${summary.total5kgAmount.toLocaleString()}원`}
              variant="warning"
            />
            <KPICard
              title="10kg"
              value={summary.total10kgQty}
              unit="박스"
              subtitle={`${summary.total10kgAmount.toLocaleString()}원`}
              variant="success"
            />
          </>
        )}
      </div>

      {/* 선물/판매 비율 표시 */}
      {showGiftStats && sections && (
        <div className="grid grid-cols-2 gap-2 sm:gap-3">
          <div className="p-2 sm:p-3 bg-blue-50 rounded-lg">
            <p className="text-xs text-gray-600">판매 주문</p>
            <p className="text-base sm:text-lg font-bold text-blue-600">
              {sections.sales.orderCount}건
            </p>
            <p className="text-xs text-gray-500 truncate">
              {sections.sales.totalRevenue.toLocaleString()}원
            </p>
          </div>
          <div className="p-2 sm:p-3 bg-purple-50 rounded-lg">
            <p className="text-xs text-gray-600">선물 주문</p>
            <p className="text-base sm:text-lg font-bold text-purple-600">
              {sections.gifts.orderCount}건
            </p>
            <p className="text-xs text-gray-500">
              {sections.gifts.total5kgQty + sections.gifts.total10kgQty}박스
            </p>
          </div>
        </div>
      )}

      {/* 차트 */}
      {showCharts && !compact && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
            <LineChartStats data={series} metric={metric} />
            {totalsByProduct.length > 0 && (
              <DonutChartStats data={totalsByProduct} metric={metric} />
            )}
          </div>
          <BarChartStats data={series} metric={metric} />
        </>
      )}

      {/* 기간 표시 */}
      <div className="text-xs text-gray-500 text-center">
        {formatDateRangeKorean(summary.dateRange.start, summary.dateRange.end)}
      </div>
    </div>
  );
}
