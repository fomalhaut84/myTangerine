/**
 * 라벨 관리 페이지 (개선 버전)
 */

'use client';

import { useGroupedLabels } from '@/hooks/use-labels';
import { useConfirmPayment, useMarkDelivered } from '@/hooks/use-orders';
import { LabelGroupCard } from '@/components/labels/LabelGroupCard';
import { Card } from '@/components/common/Card';
import { Input } from '@/components/ui/input';
import { apiBaseUrl } from '@/lib/api-client';
import type { Order } from '@/types/api';
import Link from 'next/link';
import { useState, useMemo, useEffect } from 'react';
import { toast } from 'sonner';

type StatusFilter = 'new' | 'pending_payment' | 'completed' | 'all';

export default function LabelsPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('new');
  const { data, isLoading, error } = useGroupedLabels(statusFilter);
  const confirmPaymentMutation = useConfirmPayment();
  const markDeliveredMutation = useMarkDelivered();

  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [dateFilter, setDateFilter] = useState('');
  const [senderFilter, setSenderFilter] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'sender'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // 배송완료 모달 관련 상태
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [deliveryOrders, setDeliveryOrders] = useState<Order[]>([]);
  const [trackingNumbers, setTrackingNumbers] = useState<Record<number, string>>({});
  const [isProcessingDelivery, setIsProcessingDelivery] = useState(false);

  // 상태 필터가 변경되면 선택된 그룹 초기화
  useEffect(() => {
    setSelectedGroups(new Set());
  }, [statusFilter]);

  // 그룹의 안정적인 고유 ID 생성
  const getGroupId = (group: { date: string; sender: { name: string; phone: string } }) => {
    return `${group.date}|${group.sender.name}|${group.sender.phone}`;
  };

  // 필터링 및 정렬된 그룹
  const filteredGroups = useMemo(() => {
    if (!data?.data) return [];

    // 1. 필터링
    const filtered = data.data.filter((group) => {
      const matchesDate = !dateFilter || group.date.includes(dateFilter);
      const matchesSender = !senderFilter ||
        group.sender.name.toLowerCase().includes(senderFilter.toLowerCase()) ||
        group.sender.phone.includes(senderFilter);

      return matchesDate && matchesSender;
    });

    // 2. 정렬
    const sorted = [...filtered].sort((a, b) => {
      let compareResult = 0;

      if (sortBy === 'date') {
        // 날짜순 정렬: 타임스탬프 비교
        const dateA = new Date(a.orders[0].timestamp).getTime();
        const dateB = new Date(b.orders[0].timestamp).getTime();
        compareResult = dateA - dateB;
      } else {
        // 보내는사람순 정렬: 이름 사전순
        compareResult = a.sender.name.localeCompare(b.sender.name, 'ko-KR');
      }

      // 정렬 방향 적용
      return sortOrder === 'asc' ? compareResult : -compareResult;
    });

    return sorted;
  }, [data, dateFilter, senderFilter, sortBy, sortOrder]);

  // 선택된 그룹들의 텍스트 생성
  const getSelectedLabelsText = () => {
    if (!data?.data) return '';

    const selectedData = filteredGroups.filter((group) =>
      selectedGroups.has(getGroupId(group))
    );

    return selectedData
      .map((group) => {
        const header = `====================\n${group.date}\n====================\n`;

        // 보내는분 정보 (항상 표시, 빈 값 방어)
        const phoneInfo = group.sender.phone ? ` (${group.sender.phone})` : '';
        const addressInfo = group.sender.address ? `\n주소: ${group.sender.address}` : '';
        const senderInfo = `\n보내는분: ${group.sender.name}${phoneInfo}${addressInfo}\n`;

        const orders = group.orders
          .map((order) => {
            // 상품 정보: validationError 우선, 그 다음 productType, 그 다음 "알 수 없음"
            const productInfo = order.validationError
              ? `[오류] ${order.validationError}`
              : order.productType
              ? `${order.productType} x ${order.quantity}박스`
              : '알 수 없음';

            // 송장번호가 있으면 표시
            const trackingInfo = order.trackingNumber ? `\n송장번호: ${order.trackingNumber}` : '';

            return `\n받으실분: ${order.recipient.name}\n주소: ${order.recipient.address}\n전화번호: ${order.recipient.phone}${trackingInfo}\n${productInfo}\n\n---`;
          })
          .join('\n');

        // 수량만 표시 (금액 제외)
        const totalBoxes = group.summary['5kg'].count + group.summary['10kg'].count;
        const summary = `\n\n주문 수량:\n  5kg: ${group.summary['5kg'].count}박스\n  10kg: ${group.summary['10kg'].count}박스\n  총: ${totalBoxes}박스\n\n====================\n`;

        return header + senderInfo + orders + summary;
      })
      .join('\n');
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedGroups(new Set(filteredGroups.map(group => getGroupId(group))));
    } else {
      setSelectedGroups(new Set());
    }
  };

  const handleSelectGroup = (groupId: string, selected: boolean) => {
    const newSelected = new Set(selectedGroups);
    if (selected) {
      newSelected.add(groupId);
    } else {
      newSelected.delete(groupId);
    }
    setSelectedGroups(newSelected);
  };

  const handleCopy = async () => {
    const text = getSelectedLabelsText();
    if (!text) {
      toast.error('선택된 라벨이 없습니다.');
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      toast.success('클립보드에 복사되었습니다.');
    } catch (error) {
      toast.error('클립보드 복사에 실패했습니다.');
    }
  };

  const handlePrint = () => {
    const text = getSelectedLabelsText();
    if (!text) {
      toast.error('선택된 라벨이 없습니다.');
      return;
    }

    // 프린트용 윈도우 생성
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    // XSS 방지: textContent를 사용하여 안전하게 텍스트 삽입
    printWindow.document.write(`
      <html>
        <head>
          <title>배송 라벨</title>
          <style>
            body { font-family: monospace; white-space: pre-wrap; padding: 20px; }
          </style>
        </head>
        <body><pre id="content"></pre></body>
      </html>
    `);
    printWindow.document.close();

    // textContent를 사용하여 안전하게 텍스트 삽입 (HTML 이스케이프)
    const preElement = printWindow.document.getElementById('content');
    if (preElement) {
      preElement.textContent = text;
    }

    printWindow.print();
  };

  const handleConfirmPayment = async () => {
    if (selectedGroups.size === 0) {
      toast.error('선택된 라벨이 없습니다.');
      return;
    }

    // 선택된 그룹의 모든 rowNumber 추출
    const selectedData = filteredGroups.filter((group) =>
      selectedGroups.has(getGroupId(group))
    );
    const totalOrders = selectedData.reduce((sum, group) => sum + group.orders.length, 0);

    if (!confirm(`${selectedGroups.size}개 그룹 (총 ${totalOrders}건)의 주문을 입금확인 처리하시겠습니까?`)) {
      return;
    }

    try {
      // 선택된 그룹의 모든 주문에 대해 입금확인 처리
      const rowNumbers = selectedData.flatMap(group =>
        group.orders.map(order => order.rowNumber)
      );

      let successCount = 0;
      let failCount = 0;

      for (const rowNumber of rowNumbers) {
        try {
          await confirmPaymentMutation.mutateAsync(rowNumber);
          successCount++;
        } catch (error) {
          failCount++;
          console.error(`Failed to confirm payment for order ${rowNumber}:`, error);
        }
      }

      if (failCount === 0) {
        toast.success(`${successCount}건의 주문이 입금확인 되었습니다.`);
      } else {
        toast.warning(`${successCount}건 입금확인, ${failCount}건 실패했습니다.`);
      }

      setSelectedGroups(new Set());
    } catch (error) {
      toast.error('입금확인 처리 중 오류가 발생했습니다.');
    }
  };

  // 배송완료 모달 열기
  const handleOpenDeliveryModal = () => {
    if (selectedGroups.size === 0) {
      toast.error('선택된 라벨이 없습니다.');
      return;
    }

    // 선택된 그룹의 모든 주문 추출
    const selectedData = filteredGroups.filter((group) =>
      selectedGroups.has(getGroupId(group))
    );
    const orders = selectedData.flatMap(group => group.orders);

    // 송장번호 상태 초기화
    const initialTrackingNumbers: Record<number, string> = {};
    orders.forEach(order => {
      initialTrackingNumbers[order.rowNumber] = '';
    });

    setDeliveryOrders(orders);
    setTrackingNumbers(initialTrackingNumbers);
    setShowDeliveryModal(true);
  };

  // 배송완료 일괄 처리
  const handleBulkMarkDelivered = async () => {
    setIsProcessingDelivery(true);

    try {
      let successCount = 0;
      let failCount = 0;

      for (const order of deliveryOrders) {
        try {
          const trackingNumber = trackingNumbers[order.rowNumber]?.trim() || undefined;
          await markDeliveredMutation.mutateAsync({
            rowNumber: order.rowNumber,
            trackingNumber,
          });
          successCount++;
        } catch (error) {
          failCount++;
          console.error(`Failed to mark delivered for order ${order.rowNumber}:`, error);
        }
      }

      if (failCount === 0) {
        toast.success(`${successCount}건의 주문이 배송완료 처리되었습니다.`);
      } else {
        toast.warning(`${successCount}건 완료, ${failCount}건 실패했습니다.`);
      }

      setShowDeliveryModal(false);
      setSelectedGroups(new Set());
    } catch (error) {
      toast.error('배송완료 처리 중 오류가 발생했습니다.');
    } finally {
      setIsProcessingDelivery(false);
    }
  };

  const handleDownloadPDF = async () => {
    if (selectedGroups.size === 0) {
      toast.error('선택된 라벨이 없습니다.');
      return;
    }

    // 선택된 그룹의 모든 주문 추출
    const selectedData = filteredGroups.filter((group) =>
      selectedGroups.has(getGroupId(group))
    );
    const selectedOrders = selectedData.flatMap(group => group.orders);

    // 1000건 초과 검증
    if (selectedOrders.length > 1000) {
      toast.error('한 번에 최대 1000개의 주문만 PDF로 다운로드할 수 있습니다.');
      return;
    }

    const toastId = toast.loading('PDF 파일을 생성하는 중입니다...');

    try {
      // POST 방식으로 PDF 요청 (URL 길이 제한 우회)
      const rowNumbers = selectedOrders.map(order => order.rowNumber);
      const response = await fetch(`${apiBaseUrl}/api/orders/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rowNumbers }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'PDF 생성에 실패했습니다.');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      // 파일명 생성 (응답 헤더에서 가져오거나 기본값 사용)
      const contentDisposition = response.headers.get('Content-Disposition');
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
      const filename = filenameMatch ? filenameMatch[1] : `labels-${dateStr}.pdf`;

      // iOS 감지 (iOS의 모든 브라우저는 WebKit 사용)
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

      if (isIOS) {
        // iOS: 새 탭에서 PDF 열기 (사용자가 직접 저장)
        // iOS에서는 프로그래밍 방식 다운로드가 제한됨
        window.open(url, '_blank');
        toast.success(
          `${selectedOrders.length}개의 주문 PDF가 열렸습니다. 공유 버튼을 눌러 저장하세요.`,
          { id: toastId }
        );
      } else {
        // 기타 브라우저: 프로그래밍 방식 다운로드
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        toast.success(`${selectedOrders.length}개의 주문을 PDF로 다운로드했습니다.`, { id: toastId });
      }
    } catch (error) {
      console.error('PDF 다운로드 실패:', error);
      const errorMessage = error instanceof Error ? error.message : 'PDF 파일 다운로드에 실패했습니다.';
      toast.error(errorMessage, { id: toastId });
    }
  };

  const handleDownloadExcel = async () => {
    if (selectedGroups.size === 0) {
      toast.error('선택된 라벨이 없습니다.');
      return;
    }

    // 선택된 그룹의 모든 주문 추출
    const selectedData = filteredGroups.filter((group) =>
      selectedGroups.has(getGroupId(group))
    );
    const selectedOrders = selectedData.flatMap(group => group.orders);

    // 1000건 초과 검증
    if (selectedOrders.length > 1000) {
      toast.error('한 번에 최대 1000개의 주문만 Excel로 다운로드할 수 있습니다.');
      return;
    }

    const toastId = toast.loading('Excel 파일을 생성하는 중입니다...');

    try {
      // POST 방식으로 Excel 요청 (URL 길이 제한 우회)
      const rowNumbers = selectedOrders.map(order => order.rowNumber);
      const response = await fetch(`${apiBaseUrl}/api/orders/report/excel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rowNumbers }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Excel 생성에 실패했습니다.');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      // 파일명 생성 (응답 헤더에서 가져오거나 기본값 사용)
      const contentDisposition = response.headers.get('Content-Disposition');
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
      const filename = filenameMatch ? filenameMatch[1] : `labels-${dateStr}.xlsx`;

      // iOS 감지 (iOS의 모든 브라우저는 WebKit 사용)
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

      if (isIOS) {
        // iOS: 새 탭에서 파일 열기 (사용자가 직접 저장)
        window.open(url, '_blank');
        toast.success(
          `${selectedOrders.length}개의 주문 Excel이 열렸습니다. 공유 버튼을 눌러 저장하세요.`,
          { id: toastId }
        );
      } else {
        // 기타 브라우저: 프로그래밍 방식 다운로드
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        toast.success(`${selectedOrders.length}개의 주문을 Excel로 다운로드했습니다.`, { id: toastId });
      }
    } catch (error) {
      console.error('Excel 다운로드 실패:', error);
      const errorMessage = error instanceof Error ? error.message : 'Excel 파일 다운로드에 실패했습니다.';
      toast.error(errorMessage, { id: toastId });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        {/* 헤더 */}
        <div className="mb-6 sm:mb-8">
          <Link
            href="/dashboard"
            className="text-sm text-blue-600 hover:text-blue-700 mb-2 inline-block"
          >
            ← 대시보드로 돌아가기
          </Link>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
            배송 라벨
          </h1>
        </div>

        {/* 액션 및 필터 */}
        <Card className="mb-6">
          <div className="space-y-4">
            {/* 액션 버튼 */}
            <div className="flex flex-wrap gap-2 sm:gap-3">
              <button
                onClick={() => handleSelectAll(selectedGroups.size !== filteredGroups.length)}
                disabled={filteredGroups.length === 0}
                className="px-3 sm:px-4 py-2 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-400 text-white rounded-lg text-sm sm:text-base font-medium transition-colors"
              >
                {selectedGroups.size === filteredGroups.length ? '해제' : '전체'}
              </button>

              <button
                onClick={handleCopy}
                disabled={selectedGroups.size === 0}
                className="px-3 sm:px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg text-sm sm:text-base font-medium transition-colors"
              >
                <span className="hidden sm:inline">복사 ({selectedGroups.size})</span>
                <span className="sm:hidden">복사</span>
              </button>

              <button
                onClick={handlePrint}
                disabled={selectedGroups.size === 0}
                className="px-3 sm:px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg text-sm sm:text-base font-medium transition-colors"
              >
                <span className="hidden sm:inline">출력 ({selectedGroups.size})</span>
                <span className="sm:hidden">출력</span>
              </button>

              {/* 신규주문 상태일 때만 입금확인 버튼 표시 */}
              {statusFilter === 'new' && (
                <button
                  onClick={handleConfirmPayment}
                  disabled={confirmPaymentMutation.isPending || selectedGroups.size === 0}
                  className="px-3 sm:px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 text-white rounded-lg text-sm sm:text-base font-medium transition-colors"
                >
                  {confirmPaymentMutation.isPending ? '처리 중...' : '입금확인'}
                </button>
              )}

              {/* 입금확인 상태일 때만 배송완료 버튼 표시 */}
              {statusFilter === 'pending_payment' && (
                <button
                  onClick={handleOpenDeliveryModal}
                  disabled={selectedGroups.size === 0}
                  className="px-3 sm:px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg text-sm sm:text-base font-medium transition-colors"
                >
                  배송완료
                </button>
              )}

              <button
                onClick={handleDownloadPDF}
                disabled={selectedGroups.size === 0}
                className="px-3 sm:px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white rounded-lg text-sm sm:text-base font-medium transition-colors"
              >
                PDF
              </button>

              <button
                onClick={handleDownloadExcel}
                disabled={selectedGroups.size === 0}
                className="px-3 sm:px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-gray-400 text-white rounded-lg text-sm sm:text-base font-medium transition-colors"
              >
                Excel
              </button>
            </div>

            {/* 필터 */}
            <div className="space-y-3 sm:space-y-4">
              {/* 상태 필터 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  주문 상태
                </label>
                <div className="flex flex-wrap gap-3 sm:gap-4">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value="new"
                      checked={statusFilter === 'new'}
                      onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                      className="mr-2"
                    />
                    <span className="text-sm">신규주문</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value="pending_payment"
                      checked={statusFilter === 'pending_payment'}
                      onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                      className="mr-2"
                    />
                    <span className="text-sm">입금확인</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value="completed"
                      checked={statusFilter === 'completed'}
                      onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                      className="mr-2"
                    />
                    <span className="text-sm">배송완료</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value="all"
                      checked={statusFilter === 'all'}
                      onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                      className="mr-2"
                    />
                    <span className="text-sm">전체</span>
                  </label>
                </div>
              </div>

              {/* 정렬 옵션 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  정렬
                </label>
                <div className="flex flex-wrap gap-3 sm:gap-4">
                  <div className="flex gap-2 sm:gap-3">
                    <label className="flex items-center">
                      <input
                        type="radio"
                        value="date"
                        checked={sortBy === 'date'}
                        onChange={(e) => setSortBy(e.target.value as 'date')}
                        className="mr-2"
                      />
                      <span className="text-sm">날짜순</span>
                    </label>
                    <label className="flex items-center">
                      <input
                        type="radio"
                        value="sender"
                        checked={sortBy === 'sender'}
                        onChange={(e) => setSortBy(e.target.value as 'sender')}
                        className="mr-2"
                      />
                      <span className="text-sm">보내는사람순</span>
                    </label>
                  </div>
                  <div className="flex gap-2 sm:gap-3">
                    <label className="flex items-center">
                      <input
                        type="radio"
                        value="asc"
                        checked={sortOrder === 'asc'}
                        onChange={(e) => setSortOrder(e.target.value as 'asc')}
                        className="mr-1 sm:mr-2"
                      />
                      <span className="text-sm">오름차순</span>
                    </label>
                    <label className="flex items-center">
                      <input
                        type="radio"
                        value="desc"
                        checked={sortOrder === 'desc'}
                        onChange={(e) => setSortOrder(e.target.value as 'desc')}
                        className="mr-1 sm:mr-2"
                      />
                      <span className="text-sm">내림차순</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* 날짜 및 발신자 필터 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    날짜 필터
                  </label>
                  <Input
                    type="text"
                    placeholder="날짜로 검색..."
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    발신자 필터
                  </label>
                  <Input
                    type="text"
                    placeholder="이름 또는 전화번호로 검색..."
                    value={senderFilter}
                    onChange={(e) => setSenderFilter(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* 그리드 뷰 */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-64 bg-gray-200 rounded-lg animate-pulse"></div>
            ))}
          </div>
        ) : error ? (
          <Card>
            <div className="text-center py-12 text-red-600">
              라벨 정보를 불러오는 중 오류가 발생했습니다.
            </div>
          </Card>
        ) : filteredGroups.length === 0 ? (
          <Card>
            <div className="text-center py-12 text-gray-500">
              {data?.data.length === 0
                ? statusFilter === 'new'
                  ? '신규주문이 없습니다.'
                  : statusFilter === 'pending_payment'
                  ? '입금확인 주문이 없습니다.'
                  : statusFilter === 'completed'
                  ? '배송완료 주문이 없습니다.'
                  : '주문이 없습니다.'
                : '필터 조건에 맞는 라벨이 없습니다.'}
            </div>
          </Card>
        ) : (
          <div>
            <div className="mb-3 sm:mb-4 text-sm text-gray-600">
              전체 <span className="font-semibold">{data?.data.length}개</span> 중{' '}
              <span className="font-semibold">{filteredGroups.length}개</span>{' '}
              (선택: {selectedGroups.size}개)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {filteredGroups.map((group) => {
                const groupId = getGroupId(group);
                return (
                  <LabelGroupCard
                    key={groupId}
                    group={group}
                    isSelected={selectedGroups.has(groupId)}
                    onSelect={(selected) => handleSelectGroup(groupId, selected)}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 배송완료 모달 */}
      {showDeliveryModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col shadow-xl">
            <div className="p-6 border-b">
              <h2 className="text-xl font-bold text-gray-900">
                배송완료 처리
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                총 {deliveryOrders.length}건의 주문을 배송완료 처리합니다.
                각 주문별로 송장번호를 입력할 수 있습니다.
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-4">
                {deliveryOrders.map((order, index) => (
                  <div
                    key={order.rowNumber}
                    className="p-4 border rounded-lg bg-gray-50"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <span className="text-sm font-medium text-gray-500">
                          #{index + 1}
                        </span>
                        <span className="text-sm text-gray-400 ml-2">
                          (행 {order.rowNumber})
                        </span>
                      </div>
                      <span className="text-sm text-gray-600">
                        {order.productType} x {order.quantity}
                      </span>
                    </div>
                    <div className="text-sm text-gray-800 mb-2">
                      <strong>받는분:</strong> {order.recipient.name}
                    </div>
                    <div className="text-sm text-gray-600 mb-3">
                      {order.recipient.address}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        송장번호 (선택)
                      </label>
                      <Input
                        type="text"
                        placeholder="송장번호 입력"
                        value={trackingNumbers[order.rowNumber] || ''}
                        onChange={(e) => setTrackingNumbers(prev => ({
                          ...prev,
                          [order.rowNumber]: e.target.value,
                        }))}
                        className="w-full"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-6 border-t flex justify-end gap-3">
              <button
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-medium transition-colors"
                onClick={() => setShowDeliveryModal(false)}
                disabled={isProcessingDelivery}
              >
                취소
              </button>
              <button
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
                onClick={handleBulkMarkDelivered}
                disabled={isProcessingDelivery}
              >
                {isProcessingDelivery ? '처리 중...' : `${deliveryOrders.length}건 배송완료`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
