'use client';

import { useState } from 'react';
import { useOrderStats } from '@/hooks/use-stats';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { KPICard } from '@/components/stats/KPICard';
import { LineChartStats } from '@/components/stats/LineChartStats';
import { DonutChartStats } from '@/components/stats/DonutChartStats';
import { BarChartStats } from '@/components/stats/BarChartStats';
import { AreaChartStats } from '@/components/stats/AreaChartStats';
import { Loader2, Gift, ShoppingCart, BarChart3, AlertTriangle } from 'lucide-react';
import { formatDateRangeKorean } from '@/lib/utils';
import type { OrderTypeFilter } from '@/types/api';

type StatsRange = '6m' | '12m' | 'custom';
type StatsMetric = 'quantity' | 'amount';

const ORDER_TYPE_TABS: { value: OrderTypeFilter; label: string; icon: typeof BarChart3 }[] = [
  { value: 'all', label: '전체', icon: BarChart3 },
  { value: 'customer', label: '판매', icon: ShoppingCart },
  { value: 'gift', label: '선물', icon: Gift },
  { value: 'claim', label: '배송사고', icon: AlertTriangle },
];

export default function StatsPage() {
  const [range, setRange] = useState<StatsRange>('12m');
  const [metric, setMetric] = useState<StatsMetric>('quantity');
  const [orderType, setOrderType] = useState<OrderTypeFilter>('all');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');

  const { data: stats, isLoading, isFetching } = useOrderStats(
    {
      scope: 'completed',
      range,
      metric,
      orderType,
      ...(range === 'custom' && customStart && customEnd
        ? { start: customStart, end: customEnd }
        : {}),
    },
    {
      // Custom range인 경우 날짜가 모두 입력되었을 때만 쿼리 실행
      enabled: range !== 'custom' || (!!customStart && !!customEnd),
    }
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Custom range에서 날짜를 선택 중일 때
  if (range === 'custom' && (!customStart || !customEnd)) {
    return (
      <div className="container mx-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">통계</h1>
            <p className="text-muted-foreground">
              완료된 주문 기반 상세 통계 및 분석
            </p>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-4">
              {/* Range Filter */}
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium">기간:</label>
                <select
                  value={range}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '6m' || value === '12m' || value === 'custom') {
                      setRange(value);
                    }
                  }}
                  className="px-3 py-2 border rounded-md text-sm"
                >
                  <option value="6m">최근 6개월</option>
                  <option value="12m">최근 12개월</option>
                  <option value="custom">사용자 지정</option>
                </select>
              </div>

              {/* Custom Date Range */}
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium">시작일:</label>
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="px-3 py-2 border rounded-md text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium">종료일:</label>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="px-3 py-2 border rounded-md text-sm"
                />
              </div>

              {/* Metric Filter */}
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium">기준:</label>
                <select
                  value={metric}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === 'quantity' || value === 'amount') {
                      setMetric(value);
                    }
                  }}
                  className="px-3 py-2 border rounded-md text-sm"
                >
                  <option value="quantity">수량</option>
                  <option value="amount">금액</option>
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Placeholder */}
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center space-y-2">
            <p className="text-muted-foreground text-lg">시작일과 종료일을 선택하세요</p>
            <p className="text-sm text-muted-foreground">날짜를 선택하면 통계가 표시됩니다</p>
          </div>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">통계 데이터를 불러올 수 없습니다.</p>
      </div>
    );
  }

  const { summary, series, totalsByProduct } = stats;

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">통계</h1>
          <p className="text-muted-foreground">
            완료된 주문 기반 상세 통계 및 분석
          </p>
        </div>
        {isFetching && (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Order Type Tabs */}
      <div className="flex flex-wrap gap-2">
        {ORDER_TYPE_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = orderType === tab.value;
          return (
            <button
              key={tab.value}
              onClick={() => setOrderType(tab.value)}
              className={`flex items-center gap-1 sm:gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-muted/80'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
              {stats?.sections && tab.value !== 'claim' && (
                <span className={`ml-1 text-xs ${isActive ? 'opacity-80' : 'text-muted-foreground'}`}>
                  ({tab.value === 'all'
                    ? stats.sections.overall.orderCount
                    : tab.value === 'customer'
                      ? stats.sections.sales.orderCount
                      : stats.sections.gifts.orderCount})
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 선물 탭 안내 메시지 */}
      {orderType === 'gift' && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
          선물 주문은 매출에서 제외됩니다. 수량 기준 통계만 유효합니다.
        </div>
      )}

      {/* 배송사고 탭 안내 메시지 */}
      {orderType === 'claim' && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
          배송사고 주문은 파손 보상으로 발송된 주문입니다. 매출에서 제외됩니다.
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4">
            {/* Range Filter */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">기간:</label>
              <select
                value={range}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === '6m' || value === '12m' || value === 'custom') {
                    setRange(value);
                  }
                }}
                className="px-3 py-2 border rounded-md text-sm"
              >
                <option value="6m">최근 6개월</option>
                <option value="12m">최근 12개월</option>
                <option value="custom">사용자 지정</option>
              </select>
            </div>

            {/* Custom Date Range */}
            {range === 'custom' && (
              <>
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium">시작일:</label>
                  <input
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="px-3 py-2 border rounded-md text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium">종료일:</label>
                  <input
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="px-3 py-2 border rounded-md text-sm"
                  />
                </div>
              </>
            )}

            {/* Metric Filter */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">기준:</label>
              <select
                value={metric}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === 'quantity' || value === 'amount') {
                    setMetric(value);
                  }
                }}
                className="px-3 py-2 border rounded-md text-sm"
              >
                <option value="quantity">수량</option>
                <option value="amount">금액</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI Cards */}
      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="총 매출"
          value={summary.totalRevenue}
          unit="원"
          subtitle={formatDateRangeKorean(summary.dateRange.start, summary.dateRange.end)}
        />
        <KPICard
          title="평균 주문 금액"
          value={summary.avgOrderAmount}
          unit="원"
          subtitle="주문당 평균 금액"
        />
        <KPICard
          title="5kg 총 수량"
          value={summary.total5kgQty}
          unit="박스"
          subtitle={`${summary.total5kgAmount.toLocaleString()}원`}
        />
        <KPICard
          title="10kg 총 수량"
          value={summary.total10kgQty}
          unit="박스"
          subtitle={`${summary.total10kgAmount.toLocaleString()}원`}
        />
      </div>

      {/* Charts Grid */}
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
        {/* Line Chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>월별 주문 추세</CardTitle>
          </CardHeader>
          <CardContent>
            <LineChartStats data={series} metric={metric} />
          </CardContent>
        </Card>

        {/* Area Chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>누적 {metric === 'quantity' ? '수량' : '매출'} 추이</CardTitle>
          </CardHeader>
          <CardContent>
            <AreaChartStats data={series} metric={metric} />
          </CardContent>
        </Card>

        {/* Donut Chart */}
        <Card>
          <CardHeader>
            <CardTitle>품목별 비율</CardTitle>
          </CardHeader>
          <CardContent>
            <DonutChartStats data={totalsByProduct} metric={metric} />
          </CardContent>
        </Card>

        {/* Bar Chart */}
        <Card>
          <CardHeader>
            <CardTitle>월별 매출 구성</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChartStats data={series} metric={metric} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
