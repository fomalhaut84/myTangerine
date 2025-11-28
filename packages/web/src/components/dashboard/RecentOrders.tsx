/**
 * 최근 주문 목록 컴포넌트
 */

'use client';

import { useOrders } from '@/hooks/use-orders';
import { Card } from '@/components/common/Card';
import { RecentOrdersSkeleton } from '@/components/common/DashboardSkeleton';
import Link from 'next/link';

export function RecentOrders() {
  const { data, isLoading, error } = useOrders();

  if (isLoading) {
    return <RecentOrdersSkeleton />;
  }

  if (error) {
    return (
      <Card title="최근 주문">
        <div className="text-red-600">
          주문 정보를 불러오는 중 오류가 발생했습니다.
        </div>
      </Card>
    );
  }

  if (!data?.success || !data?.orders || data.orders.length === 0) {
    return (
      <Card title="최근 주문">
        <div className="text-center py-8 text-gray-500">
          새로운 주문이 없습니다.
        </div>
      </Card>
    );
  }

  // 최신 주문 5개를 표시하기 위해 타임스탬프 기준 내림차순 정렬
  const recentOrders = [...data.orders]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 5);

  return (
    <Card title="최근 주문">
      <div className="space-y-3">
        {recentOrders.map((order) => (
          <div
            key={order.rowNumber}
            className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <div className="flex justify-between items-start gap-3">
              <div className="flex-1">
                <p className="font-semibold text-gray-900">
                  {order.recipient.name}
                </p>
                <p className="text-sm text-gray-600">
                  {order.recipient.address}
                </p>
                {order.validationError && (
                  <p className="mt-1 text-sm text-red-600">
                    {order.validationError}
                  </p>
                )}
              </div>
              <div className="text-right">
                {order.validationError ? (
                  <span className="inline-block px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-700 whitespace-nowrap">
                    오류
                  </span>
                ) : order.productType ? (
                  <span
                    className={`inline-block px-3 py-1 rounded-full text-sm font-medium whitespace-nowrap ${
                      order.productType === '5kg'
                        ? 'bg-orange-100 text-orange-700'
                        : 'bg-green-100 text-green-700'
                    }`}
                  >
                    {order.productType} × {order.quantity}
                  </span>
                ) : (
                  <span className="inline-block px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-700 whitespace-nowrap">
                    알 수 없음
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {data.orders.length > 5 && (
        <div className="mt-4 text-center">
          <Link
            href="/orders"
            className="text-blue-600 hover:text-blue-700 font-medium"
          >
            모든 주문 보기 ({data.count}개)
          </Link>
        </div>
      )}
    </Card>
  );
}
