/**
 * 주문 상세 페이지
 */

'use client';

import { useOrder, useConfirmSingleOrder } from '@/hooks/use-orders';
import { Card } from '@/components/common/Card';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderId = parseInt(params.orderId as string, 10);

  // 돌아가기 링크에 쿼리 파라미터 유지
  const backLink = searchParams.toString()
    ? `/orders?${searchParams.toString()}`
    : '/orders';

  // orderId가 유효한 숫자가 아니면 API 호출 전에 처리
  const isValidOrderId = Number.isFinite(orderId) && orderId >= 2;

  // 단일 주문 조회로 변경 (유효한 경우에만)
  const { data, isLoading, error } = useOrder(orderId);
  const confirmMutation = useConfirmSingleOrder();
  const [isConfirming, setIsConfirming] = useState(false);

  // API에서 직접 주문을 가져옴 (더 이상 클라이언트에서 필터링하지 않음)
  const order = data?.order ?? null;

  const handleConfirm = async () => {
    if (!order) return;

    if (!confirm('이 주문을 확인 처리하시겠습니까?')) {
      return;
    }

    setIsConfirming(true);
    try {
      await confirmMutation.mutateAsync(order.rowNumber);
      toast.success('주문이 확인되었습니다.');
      // 검색 상태를 유지하면서 주문 목록으로 이동
      router.push(backLink);
    } catch (error) {
      toast.error('주문 확인 처리 중 오류가 발생했습니다.');
    } finally {
      setIsConfirming(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-200 rounded w-1/4"></div>
            <div className="h-64 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !data?.success) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center py-12 text-red-600">
            주문 정보를 불러오는 중 오류가 발생했습니다.
          </div>
        </div>
      </div>
    );
  }

  // orderId가 유효하지 않은 경우
  if (!isValidOrderId) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-4xl mx-auto">
          <Link
            href={backLink}
            className="text-sm text-blue-600 hover:text-blue-700 mb-4 inline-block"
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

  // 주문을 찾을 수 없는 경우
  if (!order) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-4xl mx-auto">
          <Link
            href={backLink}
            className="text-sm text-blue-600 hover:text-blue-700 mb-4 inline-block"
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
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        {/* 헤더 */}
        <div className="mb-8">
          <Link
            href={backLink}
            className="text-sm text-blue-600 hover:text-blue-700 mb-2 inline-block"
          >
            ← 주문 목록으로 돌아가기
          </Link>
          <h1 className="text-3xl font-bold text-gray-900">
            주문 상세 정보
          </h1>
        </div>

        {/* 주문 기본 정보 */}
        <Card title="기본 정보" className="mb-6">
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <dt className="text-sm font-medium text-gray-500">
                주문 번호
              </dt>
              <dd className="mt-1 text-sm text-gray-900">
                #{order.rowNumber}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">
                주문 일시
              </dt>
              <dd className="mt-1 text-sm text-gray-900">
                {order.timestamp}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">
                상태
              </dt>
              <dd className="mt-1">
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    order.status === '확인'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-yellow-100 text-yellow-800'
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
              <dt className="text-sm font-medium text-gray-500">
                상품 타입
              </dt>
              <dd className="mt-1">
                {order.validationError ? (
                  <div>
                    <span className="inline-block px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-700">
                      오류
                    </span>
                    <p className="mt-2 text-sm text-red-600">
                      {order.validationError}
                    </p>
                  </div>
                ) : order.productType ? (
                  <span
                    className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${
                      order.productType === '5kg'
                        ? 'bg-orange-100 text-orange-700'
                        : 'bg-green-100 text-green-700'
                    }`}
                  >
                    {order.productType}
                  </span>
                ) : (
                  <span className="inline-block px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-700">
                    알 수 없음
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">
                수량
              </dt>
              <dd className="mt-1 text-sm text-gray-900">
                {order.quantity}개
              </dd>
            </div>
          </dl>
        </Card>

        {/* 수취인 정보 */}
        <Card title="수취인 정보" className="mb-6">
          <dl className="space-y-4">
            <div>
              <dt className="text-sm font-medium text-gray-500">
                이름
              </dt>
              <dd className="mt-1 text-sm text-gray-900">
                {order.recipient.name}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">
                전화번호
              </dt>
              <dd className="mt-1 text-sm text-gray-900">
                {order.recipient.phone}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">
                주소
              </dt>
              <dd className="mt-1 text-sm text-gray-900">
                {order.recipient.address}
              </dd>
            </div>
          </dl>
        </Card>

        {/* 발송인 정보 */}
        <Card title="발송인 정보" className="mb-6">
          <dl className="space-y-4">
            <div>
              <dt className="text-sm font-medium text-gray-500">
                이름
              </dt>
              <dd className="mt-1 text-sm text-gray-900">
                {order.sender.name}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">
                전화번호
              </dt>
              <dd className="mt-1 text-sm text-gray-900">
                {order.sender.phone}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">
                주소
              </dt>
              <dd className="mt-1 text-sm text-gray-900">
                {order.sender.address}
              </dd>
            </div>
          </dl>
        </Card>

        {/* 액션 버튼 */}
        {order.status !== '확인' && (
          <div className="flex justify-end">
            <button
              className="px-6 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
              onClick={handleConfirm}
              disabled={isConfirming || confirmMutation.isPending}
            >
              {isConfirming || confirmMutation.isPending
                ? '처리 중...'
                : '이 주문 확인'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
