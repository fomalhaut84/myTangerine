/**
 * 대시보드 페이지
 */

import { SummaryCard } from '@/components/dashboard/SummaryCard';
import { RecentOrders } from '@/components/dashboard/RecentOrders';
import { QuickActions } from '@/components/dashboard/QuickActions';
import { MonthlyTrendChart } from '@/components/dashboard/MonthlyTrendChart';
import { ProductRatioChart } from '@/components/dashboard/ProductRatioChart';
import { CompletedOrdersStats } from '@/components/dashboard/CompletedOrdersStats';

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          대시보드
        </h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 왼쪽: 주문 요약 */}
          <div className="lg:col-span-1">
            <SummaryCard />
          </div>

          {/* 중앙: 최근 주문 */}
          <div className="lg:col-span-2">
            <RecentOrders />
          </div>
        </div>

        {/* 완료 주문 통계 영역 */}
        <div className="mt-8">
          <CompletedOrdersStats />
        </div>

        {/* 기존 차트 영역 */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 월별 추이 차트 */}
          <MonthlyTrendChart />

          {/* 상품 비율 차트 */}
          <ProductRatioChart />
        </div>

        {/* 하단: 빠른 작업 */}
        <div className="mt-6 max-w-md">
          <QuickActions />
        </div>
      </div>
    </div>
  );
}
