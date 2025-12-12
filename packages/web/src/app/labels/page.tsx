/**
 * 라벨 관리 페이지 (개선 버전)
 */

'use client';

import { useGroupedLabels } from '@/hooks/use-labels';
import { useConfirmSingleOrder } from '@/hooks/use-orders';
import { LabelGroupCard } from '@/components/labels/LabelGroupCard';
import { Card } from '@/components/common/Card';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import { useState, useMemo, useEffect } from 'react';
import { toast } from 'sonner';

export default function LabelsPage() {
  const [statusFilter, setStatusFilter] = useState<'new' | 'completed' | 'all'>('new');
  const { data, isLoading, error } = useGroupedLabels(statusFilter);
  const confirmSingleMutation = useConfirmSingleOrder();

  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [dateFilter, setDateFilter] = useState('');
  const [senderFilter, setSenderFilter] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'sender'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

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
        const senderInfo = `\n보내는분: ${group.sender.name} (${group.sender.phone})\n주소: ${group.sender.address}\n`;

        const orders = group.orders
          .map((order) => {
            // 상품 정보: validationError 우선, 그 다음 productType, 그 다음 "알 수 없음"
            const productInfo = order.validationError
              ? `[오류] ${order.validationError}`
              : order.productType
              ? `${order.productType} x ${order.quantity}박스`
              : '알 수 없음';

            return `\n받으실분: ${order.recipient.name}\n주소: ${order.recipient.address}\n전화번호: ${order.recipient.phone}\n${productInfo}\n\n---`;
          })
          .join('\n');

        const summary = `\n\n보내는분별 수량:\n  5kg: ${group.summary['5kg'].count} (${group.summary['5kg'].amount}원)\n  10kg: ${group.summary['10kg'].count} (${group.summary['10kg'].amount}원)\n  합계: ${group.summary.total}원\n\n====================\n`;

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

  const handleConfirm = async () => {
    if (selectedGroups.size === 0) {
      toast.error('선택된 라벨이 없습니다.');
      return;
    }

    // 선택된 그룹의 모든 rowNumber 추출
    const selectedData = filteredGroups.filter((group) =>
      selectedGroups.has(getGroupId(group))
    );
    const totalOrders = selectedData.reduce((sum, group) => sum + group.orders.length, 0);

    if (!confirm(`${selectedGroups.size}개 그룹 (총 ${totalOrders}건)의 주문을 확인 처리하시겠습니까?`)) {
      return;
    }

    try {
      // 선택된 그룹의 모든 주문에 대해 개별 확인 처리
      const rowNumbers = selectedData.flatMap(group =>
        group.orders.map(order => order.rowNumber)
      );

      let successCount = 0;
      let failCount = 0;

      for (const rowNumber of rowNumbers) {
        try {
          await confirmSingleMutation.mutateAsync(rowNumber);
          successCount++;
        } catch (error) {
          failCount++;
          console.error(`Failed to confirm order ${rowNumber}:`, error);
        }
      }

      if (failCount === 0) {
        toast.success(`${successCount}건의 주문이 확인되었습니다.`);
      } else {
        toast.warning(`${successCount}건 확인, ${failCount}건 실패했습니다.`);
      }

      setSelectedGroups(new Set());
    } catch (error) {
      toast.error('주문 확인 처리 중 오류가 발생했습니다.');
    }
  };

  const handleDownloadPDF = async () => {
    if (selectedGroups.size === 0) {
      toast.error('선택된 라벨이 없습니다.');
      return;
    }

    const toastId = toast.loading('PDF 파일을 생성하는 중입니다...');

    try {
      // 선택된 그룹의 모든 주문 추출
      const selectedData = filteredGroups.filter((group) =>
        selectedGroups.has(getGroupId(group))
      );
      const selectedOrders = selectedData.flatMap(group => group.orders);

      // API 엔드포인트 URL 구성
      const params = new URLSearchParams();
      params.append('limit', selectedOrders.length.toString());

      const apiUrl = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4001'}/api/orders/report?${params.toString()}`;

      // PDF 다운로드
      const response = await fetch(apiUrl);

      if (!response.ok) {
        throw new Error('PDF 생성에 실패했습니다.');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      // 파일명 생성 (응답 헤더에서 가져오거나 기본값 사용)
      const contentDisposition = response.headers.get('Content-Disposition');
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
      const filename = filenameMatch ? filenameMatch[1] : `labels-${dateStr}.pdf`;

      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast.success(`${selectedOrders.length}개의 주문을 PDF로 다운로드했습니다.`, { id: toastId });
    } catch (error) {
      console.error('PDF 다운로드 실패:', error);
      toast.error('PDF 파일 다운로드에 실패했습니다.', { id: toastId });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* 헤더 */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <Link
              href="/dashboard"
              className="text-sm text-blue-600 hover:text-blue-700 mb-2 inline-block"
            >
              ← 대시보드로 돌아가기
            </Link>
            <h1 className="text-3xl font-bold text-gray-900">
              배송 라벨
            </h1>
          </div>
        </div>

        {/* 액션 및 필터 */}
        <Card className="mb-6">
          <div className="space-y-4">
            {/* 액션 버튼 */}
            <div className="flex gap-3">
              <button
                onClick={() => handleSelectAll(selectedGroups.size !== filteredGroups.length)}
                disabled={filteredGroups.length === 0}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
              >
                {selectedGroups.size === filteredGroups.length ? '전체 해제' : '전체 선택'}
              </button>

              <button
                onClick={handleCopy}
                disabled={selectedGroups.size === 0}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
              >
                복사 ({selectedGroups.size})
              </button>

              <button
                onClick={handlePrint}
                disabled={selectedGroups.size === 0}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
              >
                출력 ({selectedGroups.size})
              </button>

              <button
                onClick={handleConfirm}
                disabled={confirmSingleMutation.isPending || selectedGroups.size === 0}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
              >
                {confirmSingleMutation.isPending ? '처리 중...' : `확인 (${selectedGroups.size})`}
              </button>

              <button
                onClick={handleDownloadPDF}
                disabled={selectedGroups.size === 0}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
              >
                PDF ({selectedGroups.size})
              </button>
            </div>

            {/* 필터 */}
            <div className="space-y-4">
              {/* 상태 필터 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  주문 상태
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value="new"
                      checked={statusFilter === 'new'}
                      onChange={(e) => setStatusFilter(e.target.value as 'new')}
                      className="mr-2"
                    />
                    <span className="text-sm">미확인</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value="completed"
                      checked={statusFilter === 'completed'}
                      onChange={(e) => setStatusFilter(e.target.value as 'completed')}
                      className="mr-2"
                    />
                    <span className="text-sm">확인됨</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value="all"
                      checked={statusFilter === 'all'}
                      onChange={(e) => setStatusFilter(e.target.value as 'all')}
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
                <div className="flex flex-wrap gap-4">
                  <div className="flex gap-3">
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
                  <div className="flex gap-3">
                    <label className="flex items-center">
                      <input
                        type="radio"
                        value="asc"
                        checked={sortOrder === 'asc'}
                        onChange={(e) => setSortOrder(e.target.value as 'asc')}
                        className="mr-2"
                      />
                      <span className="text-sm">오름차순</span>
                    </label>
                    <label className="flex items-center">
                      <input
                        type="radio"
                        value="desc"
                        checked={sortOrder === 'desc'}
                        onChange={(e) => setSortOrder(e.target.value as 'desc')}
                        className="mr-2"
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
                  ? '미확인 주문이 없습니다.'
                  : statusFilter === 'completed'
                  ? '확인된 주문이 없습니다.'
                  : '주문이 없습니다.'
                : '필터 조건에 맞는 라벨이 없습니다.'}
            </div>
          </Card>
        ) : (
          <div>
            <div className="mb-4 text-sm text-gray-600">
              전체 <span className="font-semibold">{data?.data.length}개</span> 중{' '}
              <span className="font-semibold">{filteredGroups.length}개</span>{' '}
              (선택: {selectedGroups.size}개)
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
    </div>
  );
}
