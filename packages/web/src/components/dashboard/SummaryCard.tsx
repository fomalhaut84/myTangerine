/**
 * 주문 요약 카드 컴포넌트
 * 신규 주문의 요약 정보와 선물 비율을 표시
 * Issue #112: MoM 트렌드 표시 추가
 */

'use client';

import { useOrdersSummary } from '@/hooks/use-orders';
import { useOrderStats } from '@/hooks/use-stats';
import { Card } from '@/components/common/Card';
import { SummaryCardSkeleton } from '@/components/common/DashboardSkeleton';
import { Gift, TrendingUp, TrendingDown, Minus } from 'lucide-react';

/** 트렌드 아이콘 컴포넌트 */
function TrendIndicator({ value }: { value: number | null }) {
  if (value === null || value === 0) {
    return <Minus className="h-3 w-3 text-gray-400" />;
  }
  if (value > 0) {
    return <TrendingUp className="h-3 w-3 text-green-500" />;
  }
  return <TrendingDown className="h-3 w-3 text-red-500" />;
}

/** 트렌드 텍스트 포맷 */
function formatTrend(value: number | null): string {
  if (value === null) return '-';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

export function SummaryCard() {
  const { data, isLoading, error } = useOrdersSummary();
  // 선물 비율 계산용 Stats API 호출
  const { data: statsData, isLoading: statsLoading, error: statsError } = useOrderStats({
    scope: 'new',
    metric: 'quantity',
  });
  // MoM 트렌드용 완료 주문 Stats API 호출 (6개월 - 최소 필요량)
  // Note: momGrowthPct는 API에서 매출 기준으로 계산됨
  const { data: trendData } = useOrderStats({
    scope: 'completed',
    range: '6m',
    metric: 'amount', // MoM은 매출 기준
  });

  if (isLoading) {
    return <SummaryCardSkeleton />;
  }

  if (error) {
    return (
      <Card title="신규 주문 요약">
        <div className="text-red-600">
          요약 정보를 불러오는 중 오류가 발생했습니다.
        </div>
      </Card>
    );
  }

  if (!data?.success || !data?.summary) {
    return (
      <Card title="신규 주문 요약">
        <div className="text-gray-500">요약 정보가 없습니다.</div>
      </Card>
    );
  }

  const { summary } = data;

  // 선물 비율 계산
  const sections = statsData?.sections;
  const giftCount = sections?.gifts?.orderCount || 0;
  const totalCount = sections?.overall?.orderCount || 0;
  const giftRatio = totalCount > 0 ? Math.round((giftCount / totalCount) * 100) : 0;

  // MoM 트렌드 추출 (최근 월 데이터)
  const latestSeries = trendData?.series?.slice(-1)[0];
  const momGrowthPct = latestSeries?.momGrowthPct ?? null;

  return (
    <Card title="신규 주문 요약">
      <div className="space-y-4">
        {/* 선물 비율 배지 */}
        {statsLoading ? (
          <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg animate-pulse">
            <div className="h-4 w-4 bg-gray-200 rounded"></div>
            <div className="h-4 w-24 bg-gray-200 rounded"></div>
          </div>
        ) : statsError ? (
          <div className="flex items-center gap-2 p-2 bg-red-50 rounded-lg">
            <Gift className="h-4 w-4 text-red-400" />
            <span className="text-sm text-red-600">
              선물 통계를 불러올 수 없습니다
            </span>
          </div>
        ) : giftRatio > 0 ? (
          <div className="flex items-center gap-2 p-2 bg-purple-50 rounded-lg">
            <Gift className="h-4 w-4 text-purple-600" />
            <span className="text-sm text-purple-700">
              선물 주문 {giftCount}건 ({giftRatio}%)
            </span>
          </div>
        ) : null}

        {/* MoM 트렌드 배지 */}
        {momGrowthPct !== null && (
          <div className={`flex items-center gap-2 p-2 rounded-lg ${
            momGrowthPct > 0 ? 'bg-green-50' : momGrowthPct < 0 ? 'bg-red-50' : 'bg-gray-50'
          }`}>
            <TrendIndicator value={momGrowthPct} />
            <span className={`text-sm ${
              momGrowthPct > 0 ? 'text-green-700' : momGrowthPct < 0 ? 'text-red-700' : 'text-gray-700'
            }`}>
              매출 전월 대비 {formatTrend(momGrowthPct)}
            </span>
          </div>
        )}

        {/* 5kg 요약 */}
        <div className="flex justify-between items-center p-4 bg-orange-50 rounded-lg">
          <div>
            <p className="text-sm text-gray-600">5kg</p>
            <p className="text-2xl font-bold text-orange-600">
              {summary['5kg'].count}박스
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-600">금액</p>
            <p className="text-xl font-semibold text-gray-900">
              {summary['5kg'].amount.toLocaleString()}원
            </p>
          </div>
        </div>

        {/* 10kg 요약 */}
        <div className="flex justify-between items-center p-4 bg-green-50 rounded-lg">
          <div>
            <p className="text-sm text-gray-600">10kg</p>
            <p className="text-2xl font-bold text-green-600">
              {summary['10kg'].count}박스
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-600">금액</p>
            <p className="text-xl font-semibold text-gray-900">
              {summary['10kg'].amount.toLocaleString()}원
            </p>
          </div>
        </div>

        {/* 총 금액 */}
        <div className="pt-4 border-t border-gray-200">
          <div className="flex justify-between items-center">
            <p className="text-lg font-semibold text-gray-900">
              총 주문 금액
            </p>
            <p className="text-2xl font-bold text-blue-600">
              {summary.total.toLocaleString()}원
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
}
