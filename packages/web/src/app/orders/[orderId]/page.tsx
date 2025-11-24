/**
 * 주문 상세 페이지
 */

'use client';

import { useOrders } from '@/hooks/use-orders';
import { Card } from '@/components/common/Card';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo } from 'react';

export default function OrderDetailPage() {
  const params = useParams();
  const orderId = params.orderId as string;
  const { data, isLoading, error } = useOrders();

  // rowNumber로 주문 찾기
  const order = useMemo(() => {
    if (!data?.orders) return null;
    return data.orders.find((o) => o.rowNumber.toString() === orderId);
  }, [data?.orders, orderId]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
            <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !data?.success) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center py-12 text-red-600">
            주문 정보를 불러오는 중 오류가 발생했습니다.
          </div>
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
        <div className="max-w-4xl mx-auto">
          <Link
            href="/orders"
            className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 mb-4 inline-block"
          >
            ← 주문 목록으로 돌아가기
          </Link>
          <div className="text-center py-12 text-gray-500">
            주문을 찾을 수 없습니다.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-4xl mx-auto">
        {/* 헤더 */}
        <div className="mb-8">
          <Link
            href="/orders"
            className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 mb-2 inline-block"
          >
            ← 주문 목록으로 돌아가기
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            주문 상세 정보
          </h1>
        </div>

        {/* 주문 기본 정보 */}
        <Card title="기본 정보" className="mb-6">
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                주문 번호
              </dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                #{order.rowNumber}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                주문 일시
              </dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                {order.timestamp}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                상태
              </dt>
              <dd className="mt-1">
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    order.status === '확인'
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                  }`}
                >
                  {order.status || '미확인'}
                </span>
              </dd>
            </div>
          </dl>
        </Card>

        {/* 상품 정보 */}
        <Card title="상품 정보" className="mb-6">
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                상품 타입
              </dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                {order.productType}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                수량
              </dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                {order.quantity}개
              </dd>
            </div>
          </dl>
        </Card>

        {/* 수취인 정보 */}
        <Card title="수취인 정보" className="mb-6">
          <dl className="space-y-4">
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                이름
              </dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                {order.recipient.name}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                전화번호
              </dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                {order.recipient.phone}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                주소
              </dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                {order.recipient.address}
              </dd>
            </div>
          </dl>
        </Card>

        {/* 발송인 정보 */}
        <Card title="발송인 정보" className="mb-6">
          <dl className="space-y-4">
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                이름
              </dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                {order.sender.name}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                전화번호
              </dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                {order.sender.phone}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                주소
              </dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                {order.sender.address}
              </dd>
            </div>
          </dl>
        </Card>

        {/* 액션 버튼 */}
        {order.status !== '확인' && (
          <div className="flex justify-end">
            <button
              className="px-6 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-medium transition-colors"
              onClick={() => {
                // TODO: 개별 주문 확인 API 구현
                alert('개별 주문 확인 기능은 아직 구현되지 않았습니다.');
              }}
            >
              이 주문 확인
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
