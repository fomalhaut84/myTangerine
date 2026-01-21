/**
 * 주문 상세 페이지
 * Issue #136: 수정 기능 추가
 */

'use client';

import {
  useOrder,
  useConfirmSingleOrder,
  useConfirmPayment,
  useMarkDelivered,
  useDeleteOrder,
  useRestoreOrder,
  useUpdateOrder,
  useCreateClaimOrder,
} from '@/hooks/use-orders';
import { Card } from '@/components/common/Card';
import { StatusBadge } from '@/components/orders/StatusBadge';
import { ChangeHistoryTab } from '@/components/orders/ChangeHistoryTab';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import type { OrderUpdateData } from '@/lib/api-client';

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderId = parseInt(params.orderId as string, 10);

  // Issue #155: URL에서 idType 쿼리 파라미터 읽기 (claim 주문용)
  const idType = searchParams.get('idType') as 'rowNumber' | 'dbId' | null;

  // 돌아가기 링크에 쿼리 파라미터 유지 (idType 제외)
  const backLinkParams = new URLSearchParams(searchParams);
  backLinkParams.delete('idType'); // idType은 주문 상세 전용이므로 목록 링크에서 제외
  const backLink = backLinkParams.toString()
    ? `/orders?${backLinkParams.toString()}`
    : '/orders';

  // orderId가 유효한 숫자가 아니면 API 호출 전에 처리
  // Issue #155: DB id는 1부터 시작하므로 >= 1로 변경
  const isValidOrderId = Number.isFinite(orderId) && orderId >= 1;

  // 단일 주문 조회로 변경 (유효한 orderId인 경우에만 실행)
  // Issue #155: idType 파라미터 전달
  const { data, isLoading, error, refetch } = useOrder(orderId, {
    enabled: isValidOrderId,
    idType: idType || undefined,
  });
  const confirmMutation = useConfirmSingleOrder();
  const confirmPaymentMutation = useConfirmPayment();
  const markDeliveredMutation = useMarkDelivered();
  const deleteMutation = useDeleteOrder();
  const restoreMutation = useRestoreOrder();
  const updateMutation = useUpdateOrder();
  const createClaimMutation = useCreateClaimOrder();
  const [isProcessing, setIsProcessing] = useState(false);
  const [showTrackingModal, setShowTrackingModal] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState('');

  // 수정 모드 상태 (Issue #136)
  const [isEditMode, setIsEditMode] = useState(false);
  const [editForm, setEditForm] = useState<OrderUpdateData>({});
  const [formErrors, setFormErrors] = useState<string[]>([]);

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

  // 배송완료 모달 열기
  const handleOpenTrackingModal = () => {
    setTrackingNumber('');
    setShowTrackingModal(true);
  };

  // 배송완료 처리 (송장번호 포함)
  // Issue #168: claim 주문은 idType=dbId로 처리
  const handleMarkDelivered = async () => {
    if (!order) return;

    setIsProcessing(true);
    try {
      // Issue #168: claim 주문은 dbId로 식별
      const useDbId = order.idType === 'dbId';
      const orderId = useDbId ? order.dbId! : order.rowNumber;

      await markDeliveredMutation.mutateAsync({
        orderId,
        trackingNumber: trackingNumber.trim() || undefined,
        idType: useDbId ? 'dbId' : undefined,
      });
      toast.success(
        trackingNumber.trim()
          ? `배송이 완료되었습니다. (송장번호: ${trackingNumber.trim()})`
          : '배송이 완료되었습니다.'
      );
      setShowTrackingModal(false);
      router.push(backLink);
    } catch {
      toast.error('배송 완료 처리 중 오류가 발생했습니다.');
    } finally {
      setIsProcessing(false);
    }
  };

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

  // 배송사고 등록 (Issue #152, #155)
  const handleCreateClaim = async () => {
    if (!order) return;
    if (!confirm('배송사고 주문을 등록하시겠습니까?\n동일한 내용의 신규 주문이 생성됩니다.')) return;

    setIsProcessing(true);
    try {
      const result = await createClaimMutation.mutateAsync(order.rowNumber);
      toast.success(`배송사고 주문이 등록되었습니다. (주문번호: #${result.data.claimOrderId})`);
      // Issue #155: 새로 생성된 배송사고 주문으로 이동 (DB id로 조회하기 위해 idType=dbId 추가)
      router.push(`/orders/${result.data.claimOrderId}?idType=dbId`);
    } catch {
      toast.error('배송사고 등록 중 오류가 발생했습니다.');
    } finally {
      setIsProcessing(false);
    }
  };

  // 수정 모드 시작 (Issue #136)
  const handleStartEdit = () => {
    if (!order) return;

    // 배송완료 상태에서는 송장번호만 수정 가능
    const isDelivered = order.status === '배송완료';

    setEditForm({
      sender: isDelivered ? undefined : { ...order.sender },
      recipient: isDelivered ? undefined : { ...order.recipient },
      orderType: isDelivered ? undefined : order.orderType,
      // trackingNumber는 실제 값이 있을 때만 포함 (빈 문자열이면 undefined)
      trackingNumber: order.trackingNumber || undefined,
    });
    setFormErrors([]);
    setIsEditMode(true);
  };

  // 수정 취소
  const handleCancelEdit = () => {
    setIsEditMode(false);
    setEditForm({});
    setFormErrors([]);
  };

  // 수정 저장
  const handleSaveEdit = async () => {
    if (!order) return;

    const isDelivered = order.status === '배송완료';

    // 클라이언트 검증 (배송완료가 아닌 경우에만 필수 필드 검증)
    const errors: string[] = [];
    if (!isDelivered) {
      if (editForm.recipient?.name?.trim() === '') errors.push('수취인 이름은 필수입니다.');
      if (editForm.recipient?.phone?.trim() === '') errors.push('수취인 전화번호는 필수입니다.');
      if (editForm.recipient?.address?.trim() === '') errors.push('수취인 주소는 필수입니다.');
    }

    if (errors.length > 0) {
      setFormErrors(errors);
      return;
    }

    // 빈 값 정리: undefined 필드와 빈 문자열 제거
    const cleanedData: OrderUpdateData = {};

    if (!isDelivered) {
      if (editForm.sender) cleanedData.sender = editForm.sender;
      if (editForm.recipient) cleanedData.recipient = editForm.recipient;
      if (editForm.orderType) cleanedData.orderType = editForm.orderType;
    }
    // trackingNumber 처리
    // - 값이 있으면: 수정
    // - 빈 문자열이면: 삭제 (API가 null로 변환) - 입금확인 상태에서만 허용
    if (editForm.trackingNumber !== undefined) {
      const trimmedTracking = editForm.trackingNumber.trim();
      if (trimmedTracking) {
        cleanedData.trackingNumber = trimmedTracking;
      } else if (order.status === '입금확인') {
        // 입금확인 상태에서만 송장번호 삭제 가능
        cleanedData.trackingNumber = '';
      }
    }

    // 변경사항이 없으면 경고
    if (Object.keys(cleanedData).length === 0) {
      toast.warning('변경된 내용이 없습니다.');
      return;
    }

    setIsProcessing(true);
    try {
      await updateMutation.mutateAsync({
        rowNumber: order.rowNumber,
        data: cleanedData,
      });
      toast.success('주문이 수정되었습니다.');
      setIsEditMode(false);
      setEditForm({});
      refetch();
    } catch (err) {
      const message = err instanceof Error ? err.message : '주문 수정 중 오류가 발생했습니다.';
      toast.error(message);
    } finally {
      setIsProcessing(false);
    }
  };

  // 폼 필드 업데이트 헬퍼
  const updateFormField = (
    category: 'sender' | 'recipient',
    field: 'name' | 'phone' | 'address',
    value: string
  ) => {
    setEditForm((prev) => ({
      ...prev,
      [category]: {
        ...prev[category],
        [field]: value,
      },
    }));
  };

  // orderId가 유효하지 않은 경우 (API 호출 전에 체크)
  if (!isValidOrderId) {
    return (
      <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
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
      <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
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
      <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
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
      <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
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
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto">
        {/* 헤더 */}
        <div className="mb-6 sm:mb-8">
          <Link
            href={backLink}
            className="text-sm text-blue-600 hover:text-blue-700 mb-2 inline-block"
          >
            ← 주문 목록으로 돌아가기
          </Link>
          <div className="flex items-center justify-between">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
              {isEditMode ? '주문 수정' : '주문 상세 정보'}
            </h1>
            {/* Issue #155: claim 주문은 수정 불가 (DB만 저장되어 Sheets 동기화 안 됨) */}
            {!order.isDeleted && !isEditMode && order.orderType !== 'claim' && (
              <button
                onClick={handleStartEdit}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors"
              >
                수정
              </button>
            )}
          </div>
        </div>

        {/* 수정 모드 에러 표시 */}
        {formErrors.length > 0 && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <ul className="list-disc list-inside text-sm text-red-600 space-y-1">
              {formErrors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        {/* 삭제된 주문 알림 배너 */}
        {order.isDeleted && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-red-800">삭제된 주문</h3>
                <p className="text-sm text-red-600 mt-1">
                  이 주문은 삭제 처리되었습니다.
                  {order.deletedAt && (
                    <span className="ml-1">
                      (삭제일: {new Date(order.deletedAt).toLocaleString('ko-KR')})
                    </span>
                  )}
                </p>
                <p className="text-sm text-red-600 mt-1">
                  주문을 다시 활성화하려면 하단의 &quot;복원&quot; 버튼을 클릭하세요.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 주문 기본 정보 */}
        <Card title="기본 정보" className="mb-6">
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <dt className="text-sm font-medium text-gray-500">
                주문 번호
              </dt>
              <dd className="mt-1 text-sm text-gray-900">
                {/* Issue #155: claim 주문은 원본 주문 번호 표시 */}
                {order.orderType === 'claim' ? (
                  <span>
                    배송사고 (원본: #{order.originalRowNumber || '?'})
                  </span>
                ) : (
                  `#${order.rowNumber}`
                )}
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
                        : order.orderType === 'claim'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-blue-100 text-blue-800'
                    }`}
                  >
                    {order.orderType === 'gift' ? '선물' : order.orderType === 'claim' ? '배송사고' : '판매'}
                  </span>
                </dd>
              </div>
            )}
            {/* Issue #155: 배송사고 주문의 원본 주문 링크 */}
            {order.orderType === 'claim' && order.originalRowNumber && (
              <div>
                <dt className="text-sm font-medium text-gray-500">
                  원본 주문
                </dt>
                <dd className="mt-1">
                  <Link
                    href={`/orders/${order.originalRowNumber}`}
                    className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                  >
                    #{order.originalRowNumber} 보기 →
                  </Link>
                </dd>
              </div>
            )}
            {(order.trackingNumber || (isEditMode && order.status !== '신규주문')) && (
              <div>
                <dt className="text-sm font-medium text-gray-500">
                  송장번호
                  {isEditMode && order.status === '입금확인' && editForm.trackingNumber && (
                    <button
                      type="button"
                      onClick={() => setEditForm({ ...editForm, trackingNumber: '' })}
                      className="ml-2 text-xs text-red-600 hover:text-red-700"
                    >
                      삭제
                    </button>
                  )}
                </dt>
                <dd className="mt-1">
                  {isEditMode && order.status !== '신규주문' ? (
                    <Input
                      value={editForm.trackingNumber || ''}
                      onChange={(e) => setEditForm({ ...editForm, trackingNumber: e.target.value })}
                      placeholder={order.status === '배송완료' ? '송장번호 수정' : '송장번호 입력'}
                      className="w-full font-mono"
                    />
                  ) : (
                    <span className="text-sm text-gray-900 font-mono">
                      {order.trackingNumber}
                    </span>
                  )}
                  {isEditMode && order.status === '배송완료' && (
                    <p className="mt-1 text-xs text-gray-500">
                      배송완료 상태에서는 송장번호를 삭제할 수 없습니다.
                    </p>
                  )}
                </dd>
              </div>
            )}
          </dl>
        </Card>

        {/* 상품 정보 - 상품 타입/수량은 수정 불가 (정책) */}
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
              <dd className="mt-1">
                <span className="text-sm text-gray-900">{order.quantity}개</span>
              </dd>
            </div>
            {/* 주문 유형 - 배송완료가 아닌 경우 수정 가능 */}
            {/* Issue #155: claim 타입은 "배송사고 등록" 버튼으로만 생성되므로 드롭다운에서 제거 */}
            {isEditMode && order.status !== '배송완료' ? (
              <div>
                <dt className="text-sm font-medium text-gray-500">
                  주문 유형
                </dt>
                <dd className="mt-1">
                  <select
                    value={editForm.orderType || 'customer'}
                    onChange={(e) => setEditForm({ ...editForm, orderType: e.target.value as 'customer' | 'gift' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="customer">판매</option>
                    <option value="gift">선물</option>
                  </select>
                </dd>
              </div>
            ) : order.orderType ? (
              <div>
                <dt className="text-sm font-medium text-gray-500">
                  주문 유형
                </dt>
                <dd className="mt-1">
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      order.orderType === 'gift'
                        ? 'bg-purple-100 text-purple-800'
                        : order.orderType === 'claim'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-blue-100 text-blue-800'
                    }`}
                  >
                    {order.orderType === 'gift' ? '선물' : order.orderType === 'claim' ? '배송사고' : '판매'}
                  </span>
                </dd>
              </div>
            ) : null}
          </dl>
        </Card>

        {/* 수취인 정보 - 배송완료 상태에서는 수정 불가 */}
        <Card title="수취인 정보" className="mb-6">
          <dl className="space-y-4">
            <div>
              <dt className="text-sm font-medium text-gray-500">
                이름
              </dt>
              <dd className="mt-1">
                {isEditMode && order.status !== '배송완료' ? (
                  <Input
                    value={editForm.recipient?.name || ''}
                    onChange={(e) => updateFormField('recipient', 'name', e.target.value)}
                    placeholder="수취인 이름"
                    className="w-full"
                  />
                ) : (
                  <span className="text-sm text-gray-900">{order.recipient.name}</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">
                전화번호
              </dt>
              <dd className="mt-1">
                {isEditMode && order.status !== '배송완료' ? (
                  <Input
                    value={editForm.recipient?.phone || ''}
                    onChange={(e) => updateFormField('recipient', 'phone', e.target.value)}
                    placeholder="010-0000-0000"
                    className="w-full"
                  />
                ) : (
                  <span className="text-sm text-gray-900">{order.recipient.phone}</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">
                주소
              </dt>
              <dd className="mt-1">
                {isEditMode && order.status !== '배송완료' ? (
                  <Input
                    value={editForm.recipient?.address || ''}
                    onChange={(e) => updateFormField('recipient', 'address', e.target.value)}
                    placeholder="도로명 주소"
                    className="w-full"
                  />
                ) : (
                  <span className="text-sm text-gray-900">{order.recipient.address}</span>
                )}
              </dd>
            </div>
          </dl>
        </Card>

        {/* 발송인 정보 - 배송완료 상태에서는 수정 불가 */}
        <Card title="발송인 정보" className="mb-6">
          <dl className="space-y-4">
            <div>
              <dt className="text-sm font-medium text-gray-500">
                이름
              </dt>
              <dd className="mt-1">
                {isEditMode && order.status !== '배송완료' ? (
                  <Input
                    value={editForm.sender?.name || ''}
                    onChange={(e) => updateFormField('sender', 'name', e.target.value)}
                    placeholder="발송인 이름"
                    className="w-full"
                  />
                ) : (
                  <span className="text-sm text-gray-900">{order.sender.name}</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">
                전화번호
              </dt>
              <dd className="mt-1">
                {isEditMode && order.status !== '배송완료' ? (
                  <Input
                    value={editForm.sender?.phone || ''}
                    onChange={(e) => updateFormField('sender', 'phone', e.target.value)}
                    placeholder="010-0000-0000"
                    className="w-full"
                  />
                ) : (
                  <span className="text-sm text-gray-900">{order.sender.phone}</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">
                주소
              </dt>
              <dd className="mt-1">
                {isEditMode && order.status !== '배송완료' ? (
                  <Input
                    value={editForm.sender?.address || ''}
                    onChange={(e) => updateFormField('sender', 'address', e.target.value)}
                    placeholder="도로명 주소"
                    className="w-full"
                  />
                ) : (
                  <span className="text-sm text-gray-900">{order.sender.address}</span>
                )}
              </dd>
            </div>
          </dl>
        </Card>

        {/* 액션 버튼 */}
        <div className="flex flex-wrap justify-end gap-2 sm:gap-3">
          {/* 수정 모드일 때 저장/취소 버튼 */}
          {isEditMode ? (
            <>
              <button
                className="px-4 sm:px-6 py-2 bg-gray-200 hover:bg-gray-300 disabled:bg-gray-100 text-gray-700 rounded-lg text-sm sm:text-base font-medium transition-colors"
                onClick={handleCancelEdit}
                disabled={isProcessing}
              >
                취소
              </button>
              <button
                className="px-4 sm:px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg text-sm sm:text-base font-medium transition-colors"
                onClick={handleSaveEdit}
                disabled={isProcessing}
              >
                {isProcessing ? '저장 중...' : '저장'}
              </button>
            </>
          ) : order.isDeleted ? (
            /* 삭제된 주문인 경우 복원 버튼만 표시 */
            /* Issue #155: claim 주문은 DB만 저장되어 액션 불가 */
            order.orderType !== 'claim' && (
              <button
                className="px-4 sm:px-6 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 text-white rounded-lg text-sm sm:text-base font-medium transition-colors"
                onClick={handleRestore}
                disabled={isProcessing}
              >
                {isProcessing ? '처리 중...' : '복원'}
              </button>
            )
          ) : (
            <>
              {/* 신규주문 → 입금확인 (claim 주문은 '입금확인' 상태로 생성되므로 이 버튼 불필요) */}
              {order.status === '신규주문' && order.orderType !== 'claim' && (
                <button
                  className="px-4 sm:px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg text-sm sm:text-base font-medium transition-colors"
                  onClick={handleConfirmPayment}
                  disabled={isProcessing}
                >
                  {isProcessing ? '처리 중...' : '입금확인'}
                </button>
              )}

              {/* 입금확인 → 배송완료 (Issue #168: claim 주문도 발송 처리 가능) */}
              {order.status === '입금확인' && (
                <button
                  className="px-4 sm:px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg text-sm sm:text-base font-medium transition-colors"
                  onClick={handleOpenTrackingModal}
                  disabled={isProcessing}
                >
                  {isProcessing ? '처리 중...' : '배송완료'}
                </button>
              )}

              {/* 삭제 버튼 (배송완료가 아닌 경우에만, claim 주문 제외) */}
              {/* Issue #168: claim 주문은 DB 전용이라 삭제 불가 */}
              {order.status !== '배송완료' && order.orderType !== 'claim' && (
                <button
                  className="px-4 sm:px-6 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white rounded-lg text-sm sm:text-base font-medium transition-colors"
                  onClick={handleDelete}
                  disabled={isProcessing}
                >
                  {isProcessing ? '처리 중...' : '삭제'}
                </button>
              )}

              {/* 배송사고 등록 버튼 (배송완료 상태에서만, claim 주문 제외) - Issue #152 */}
              {/* Issue #168: claim 주문에서 또 배송사고 등록은 불필요 */}
              {order.status === '배송완료' && order.orderType !== 'claim' && (
                <button
                  className="px-4 sm:px-6 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-400 text-white rounded-lg text-sm sm:text-base font-medium transition-colors"
                  onClick={handleCreateClaim}
                  disabled={isProcessing}
                >
                  {isProcessing ? '처리 중...' : '배송사고 등록'}
                </button>
              )}
            </>
          )}
        </div>

        {/* 변경 이력 (Phase 2) */}
        {/* Issue #155: claim 주문은 변경 이력이 sheetRowNumber 기준이라 표시 안 함 */}
        {!isEditMode && order.orderType !== 'claim' && (
          <Card title="" className="mt-6">
            <ChangeHistoryTab rowNumber={orderId} />
          </Card>
        )}

        {/* 송장번호 입력 모달 */}
        {showTrackingModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4 shadow-xl">
              <h2 className="text-xl font-bold text-gray-900 mb-4">
                배송 완료 처리
              </h2>
              <div className="mb-4">
                <label htmlFor="trackingNumber" className="block text-sm font-medium text-gray-700 mb-2">
                  송장번호 (선택)
                </label>
                <Input
                  id="trackingNumber"
                  type="text"
                  placeholder="송장번호를 입력하세요"
                  value={trackingNumber}
                  onChange={(e) => setTrackingNumber(e.target.value)}
                  className="w-full"
                  autoFocus
                />
                <p className="mt-2 text-sm text-gray-500">
                  송장번호 없이도 배송완료 처리가 가능합니다.
                </p>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-medium transition-colors"
                  onClick={() => setShowTrackingModal(false)}
                  disabled={isProcessing}
                >
                  취소
                </button>
                <button
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
                  onClick={handleMarkDelivered}
                  disabled={isProcessing}
                >
                  {isProcessing ? '처리 중...' : '배송완료'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
