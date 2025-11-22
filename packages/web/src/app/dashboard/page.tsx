/**
 * 대시보드 페이지
 */

import { SummaryCard } from '@/components/dashboard/SummaryCard';
import { RecentOrders } from '@/components/dashboard/RecentOrders';
import { QuickActions } from '@/components/dashboard/QuickActions';

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-8">
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

        {/* 하단: 빠른 작업 */}
        <div className="mt-6 max-w-md">
          <QuickActions />
        </div>
      </div>
    </div>
  );
}
