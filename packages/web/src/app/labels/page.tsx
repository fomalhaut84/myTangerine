/**
 * 라벨 관리 페이지 (개선 버전)
 */

'use client';

import { useGroupedLabels } from '@/hooks/use-labels';
import { useConfirmOrders } from '@/hooks/use-orders';
import { LabelGroupCard } from '@/components/labels/LabelGroupCard';
import { Card } from '@/components/common/Card';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import { useState, useMemo } from 'react';
import { toast } from 'sonner';

export default function LabelsPage() {
  const { data, isLoading, error } = useGroupedLabels();
  const confirmMutation = useConfirmOrders();

  const [selectedGroups, setSelectedGroups] = useState<Set<number>>(new Set());
  const [dateFilter, setDateFilter] = useState('');
  const [senderFilter, setSenderFilter] = useState('');

  // 필터링된 그룹
  const filteredGroups = useMemo(() => {
    if (!data?.data) return [];

    return data.data.filter((group) => {
      const matchesDate = !dateFilter || group.date.includes(dateFilter);
      const matchesSender = !senderFilter ||
        group.sender.name.toLowerCase().includes(senderFilter.toLowerCase()) ||
        group.sender.phone.includes(senderFilter);

      return matchesDate && matchesSender;
    });
  }, [data, dateFilter, senderFilter]);

  // 선택된 그룹들의 텍스트 생성
  const getSelectedLabelsText = () => {
    if (!data?.data) return '';

    const selectedData = filteredGroups.filter((_, index) =>
      selectedGroups.has(index)
    );

    return selectedData
      .map((group) => {
        const header = `====================\n${group.date}\n====================\n`;
        const senderInfo = `\n보내는분: ${group.sender.name} (${group.sender.phone})\n주소: ${group.sender.address}\n`;

        const orders = group.orders
          .map(
            (order) =>
              `\n받으실분: ${order.recipient.name}\n주소: ${order.recipient.address}\n전화번호: ${order.recipient.phone}\n${order.productType} x ${order.quantity}박스\n\n---`
          )
          .join('\n');

        const summary = `\n\n보내는분별 수량:\n  5kg: ${group.summary['5kg'].count} (${group.summary['5kg'].amount}원)\n  10kg: ${group.summary['10kg'].count} (${group.summary['10kg'].amount}원)\n  합계: ${group.summary.total}원\n\n====================\n`;

        return header + senderInfo + orders + summary;
      })
      .join('\n');
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedGroups(new Set(filteredGroups.map((_, index) => index)));
    } else {
      setSelectedGroups(new Set());
    }
  };

  const handleSelectGroup = (index: number, selected: boolean) => {
    const newSelected = new Set(selectedGroups);
    if (selected) {
      newSelected.add(index);
    } else {
      newSelected.delete(index);
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

    printWindow.document.write(`
      <html>
        <head>
          <title>배송 라벨</title>
          <style>
            body { font-family: monospace; white-space: pre-wrap; padding: 20px; }
          </style>
        </head>
        <body>${text}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const handleConfirm = async () => {
    if (selectedGroups.size === 0) {
      toast.error('선택된 라벨이 없습니다.');
      return;
    }

    if (!confirm(`${selectedGroups.size}개 그룹의 주문을 확인 처리하시겠습니까?`)) {
      return;
    }

    try {
      const result = await confirmMutation.mutateAsync();
      toast.success(result.message);
      setSelectedGroups(new Set());
    } catch (error) {
      toast.error('주문 확인 처리 중 오류가 발생했습니다.');
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
                disabled={confirmMutation.isPending || selectedGroups.size === 0}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
              >
                {confirmMutation.isPending ? '처리 중...' : `확인 (${selectedGroups.size})`}
              </button>
            </div>

            {/* 필터 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
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
        </Card>

        {/* 그리드 뷰 */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-64 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse"></div>
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
                ? '생성할 라벨이 없습니다.'
                : '필터 조건에 맞는 라벨이 없습니다.'}
            </div>
          </Card>
        ) : (
          <div>
            <div className="mb-4 text-sm text-gray-600 dark:text-gray-400">
              전체 <span className="font-semibold">{data?.data.length}개</span> 중{' '}
              <span className="font-semibold">{filteredGroups.length}개</span>{' '}
              (선택: {selectedGroups.size}개)
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredGroups.map((group, index) => (
                <LabelGroupCard
                  key={`${group.date}-${group.sender.name}-${index}`}
                  group={group}
                  isSelected={selectedGroups.has(index)}
                  onSelect={(selected) => handleSelectGroup(index, selected)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
