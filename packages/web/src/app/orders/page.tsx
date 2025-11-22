/**
 * 주문 목록 페이지
 */

'use client';

import { useOrders, useConfirmOrders } from '@/hooks/use-orders';
import { OrdersTable } from '@/components/orders/OrdersTable';
import { Card } from '@/components/common/Card';
import Link from 'next/link';
import { useState } from 'react';

export default function OrdersPage() {
  const { data, isLoading, error } = useOrders();
  const confirmMutation = useConfirmOrders();
  const [message, setMessage] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (!confirm('모든 주문을 확인 처리하시겠습니까?')) {
      return;
    }

    try {
      const result = await confirmMutation.mutateAsync();
      setMessage(result.message);
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      setMessage('주문 확인 처리 중 오류가 발생했습니다.');
      setTimeout(() => setMessage(null), 3000);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-7xl mx-auto">
        {/* 헤더 */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <Link
              href="/dashboard"
              className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 mb-2 inline-block"
            >
              ← 대시보드로 돌아가기
            </Link>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              주문 목록
            </h1>
          </div>

          <div className="flex gap-3">
            <Link
              href="/labels"
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
            >
              라벨 생성
            </Link>

            <button
              onClick={handleConfirm}
              disabled={
                confirmMutation.isPending ||
                !data?.orders ||
                data.orders.length === 0
              }
              className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
            >
              {confirmMutation.isPending ? '처리 중...' : '모두 확인'}
            </button>
          </div>
        </div>

        {/* 메시지 */}
        {message && (
          <div
            className={`mb-6 p-4 rounded-lg ${
              message.includes('오류')
                ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
            }`}
          >
            {message}
          </div>
        )}

        {/* 주문 테이블 */}
        <Card>
          {isLoading ? (
            <div className="animate-pulse space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 bg-gray-200 rounded"></div>
              ))}
            </div>
          ) : error ? (
            <div className="text-center py-12 text-red-600">
              주문 정보를 불러오는 중 오류가 발생했습니다.
            </div>
          ) : data?.success && data.orders ? (
            <>
              <div className="mb-4 text-sm text-gray-600 dark:text-gray-400">
                총 <span className="font-semibold">{data.count}개</span>의
                주문이 있습니다.
              </div>
              <OrdersTable orders={data.orders} />
            </>
          ) : (
            <div className="text-center py-12 text-gray-500">
              주문이 없습니다.
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
