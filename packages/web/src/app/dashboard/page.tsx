/**
 * 대시보드 페이지
 * 신규 주문과 완료 주문을 명확하게 분리하여 표시
 */

import { SummaryCard } from '@/components/dashboard/SummaryCard';
import { RecentOrders } from '@/components/dashboard/RecentOrders';
import { QuickActions } from '@/components/dashboard/QuickActions';
import { NewOrdersPanel } from '@/components/dashboard/NewOrdersPanel';
import { OrderStatsPanel } from '@/components/dashboard/OrderStatsPanel';

export default function DashboardPage() {
  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          대시보드
        </h1>

        {/* 상단: 신규 주문 요약 + 최근 주문 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-6">
            <SummaryCard />
            <QuickActions />
          </div>
          <div className="lg:col-span-2">
            <RecentOrders />
          </div>
        </div>

        {/* 중앙: 신규 주문 현황 + 완료 주문 통계 (2열) */}
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 신규 주문 현황 */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <NewOrdersPanel />
          </div>

          {/* 완료 주문 통계 (컴팩트 모드) */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <OrderStatsPanel
              title="완료 주문 통계"
              scope="completed"
              showCharts={false}
              showGiftStats={true}
              compact={true}
            />
          </div>
        </div>

        {/* 하단: 완료 주문 상세 통계 (차트 포함) */}
        <div className="mt-8 bg-white rounded-xl shadow-sm p-6">
          <OrderStatsPanel
            title="완료 주문 상세 분석"
            scope="completed"
            showCharts={true}
            showGiftStats={true}
          />
        </div>
      </div>
    </div>
  );
}
