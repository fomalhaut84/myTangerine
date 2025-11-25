/**
 * 주문 요약 카드 컴포넌트
 */

'use client';

import { useOrdersSummary } from '@/hooks/use-orders';
import { Card } from '@/components/common/Card';
import { SummaryCardSkeleton } from '@/components/common/DashboardSkeleton';

export function SummaryCard() {
  const { data, isLoading, error } = useOrdersSummary();

  if (isLoading) {
    return <SummaryCardSkeleton />;
  }

  if (error) {
    return (
      <Card title="주문 요약">
        <div className="text-red-600">
          요약 정보를 불러오는 중 오류가 발생했습니다.
        </div>
      </Card>
    );
  }

  if (!data?.success || !data?.summary) {
    return (
      <Card title="주문 요약">
        <div className="text-gray-500">요약 정보가 없습니다.</div>
      </Card>
    );
  }

  const { summary } = data;

  return (
    <Card title="주문 요약">
      <div className="space-y-6">
        {/* 5kg 요약 */}
        <div className="flex justify-between items-center p-4 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">5kg</p>
            <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">
              {summary['5kg'].count}박스
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-600 dark:text-gray-400">금액</p>
            <p className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {summary['5kg'].amount.toLocaleString()}원
            </p>
          </div>
        </div>

        {/* 10kg 요약 */}
        <div className="flex justify-between items-center p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">10kg</p>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">
              {summary['10kg'].count}박스
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-600 dark:text-gray-400">금액</p>
            <p className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {summary['10kg'].amount.toLocaleString()}원
            </p>
          </div>
        </div>

        {/* 총 금액 */}
        <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
          <div className="flex justify-between items-center">
            <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              총 주문 금액
            </p>
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-200">
              {summary.total.toLocaleString()}원
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
}
