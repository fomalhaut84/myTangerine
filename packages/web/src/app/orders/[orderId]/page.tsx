/**
 * 주문 상세 페이지
 */

'use client';

import {
  useOrder,
  useConfirmSingleOrder,
  useConfirmPayment,
  useMarkDelivered,
  useDeleteOrder,
  useRestoreOrder,
} from '@/hooks/use-orders';
import { Card } from '@/components/common/Card';
import { StatusBadge } from '@/components/orders/StatusBadge';
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

  // 단일 주문 조회로 변경 (유효한 orderId인 경우에만 실행)
  const { data, isLoading, error, refetch } = useOrder(orderId, {
    enabled: isValidOrderId,
  });
  const confirmMutation = useConfirmSingleOrder();
  const confirmPaymentMutation = useConfirmPayment();
  const markDeliveredMutation = useMarkDelivered();
  const deleteMutation = useDeleteOrder();
  const restoreMutation = useRestoreOrder();
  const [isProcessing, setIsProcessing] = useState(false);

  // API에서 직접 주문을 가져옴 (더 이상 클라이언트에서 필터링하지 않음)
  const order = data?.order ?? null;

  // 공통 액션 핸들러
  const handleAction = async (
    action: () => Promise<unknown>,
    confirmMessage: string,
    successMessage: string,
    errorMessage: string,
    navigateBack = false
  ) => {
    if (!order) return;
    if (!confirm(confirmMessage)) return;

    setIsProcessing(true);
    try {
      await action();
      toast.success(successMessage);
      if (navigateBack) {
        router.push(backLink);
      } else {
        refetch();
      }
    } catch {
      toast.error(errorMessage);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmPayment = () =>
    handleAction(
      () => confirmPaymentMutation.mutateAsync(order!.rowNumber),
      '입금 확인 처리하시겠습니까?',
      '입금이 확인되었습니다.',
      '입금 확인 처리 중 오류가 발생했습니다.'
    );

  const handleMarkDelivered = () =>
    handleAction(
      () => markDeliveredMutation.mutateAsync(order!.rowNumber),
      '배송 완료 처리하시겠습니까?',
      '배송이 완료되었습니다.',
      '배송 완료 처리 중 오류가 발생했습니다.',
      true
    );

  const handleDelete = () =>
    handleAction(
      () => deleteMutation.mutateAsync(order!.rowNumber),
      '이 주문을 삭제하시겠습니까?',
      '주문이 삭제되었습니다.',
      '주문 삭제 중 오류가 발생했습니다.',
      true
    );

  const handleRestore = () =>
    handleAction(
      () => restoreMutation.mutateAsync(order!.rowNumber),
      '이 주문을 복원하시겠습니까?',
      '주문이 복원되었습니다.',
      '주문 복원 중 오류가 발생했습니다.'
    );

  // orderId가 유효하지 않은 경우 (API 호출 전에 체크)
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
            유효하지 않은 주문 번호입니다.
          </div>
        </div>
      </div>
    );
  }

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
          <Link
            href={backLink}
            className="text-sm text-blue-600 hover:text-blue-700 mb-4 inline-block"
          >
            ← 주문 목록으로 돌아가기
          </Link>
          <div className="text-center py-12 text-red-600">
            주문 정보를 불러오는 중 오류가 발생했습니다.
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
                <StatusBadge status={order.status} isDeleted={order.isDeleted} size="md" />
              </dd>
            </div>
            {order.orderType && (
              <div>
                <dt className="text-sm font-medium text-gray-500">
                  주문 유형
                </dt>
                <dd className="mt-1">
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      order.orderType === 'gift'
                        ? 'bg-purple-100 text-purple-800'
                        : 'bg-blue-100 text-blue-800'
                    }`}
                  >
                    {order.orderType === 'gift' ? '선물' : '판매'}
                  </span>
                </dd>
              </div>
            )}
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
        <div className="flex justify-end gap-3">
          {/* 삭제된 주문인 경우 복원 버튼만 표시 */}
          {order.isDeleted ? (
            <button
              className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
              onClick={handleRestore}
              disabled={isProcessing}
            >
              {isProcessing ? '처리 중...' : '복원'}
            </button>
          ) : (
            <>
              {/* 신규주문 → 입금확인 */}
              {order.status === '신규주문' && (
                <button
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
                  onClick={handleConfirmPayment}
                  disabled={isProcessing}
                >
                  {isProcessing ? '처리 중...' : '입금확인'}
                </button>
              )}

              {/* 입금확인 → 배송완료 */}
              {order.status === '입금확인' && (
                <button
                  className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
                  onClick={handleMarkDelivered}
                  disabled={isProcessing}
                >
                  {isProcessing ? '처리 중...' : '배송완료'}
                </button>
              )}

              {/* 삭제 버튼 (배송완료가 아닌 경우에만) */}
              {order.status !== '배송완료' && (
                <button
                  className="px-6 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
                  onClick={handleDelete}
                  disabled={isProcessing}
                >
                  {isProcessing ? '처리 중...' : '삭제'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
