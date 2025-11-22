/**
 * 빠른 액션 버튼 컴포넌트
 */

'use client';

import Link from 'next/link';
import { useConfirmOrders } from '@/hooks/use-orders';
import { Card } from '@/components/common/Card';
import { useState } from 'react';

export function QuickActions() {
  const confirmMutation = useConfirmOrders();
  const [message, setMessage] = useState<string | null>(null);

  const handleConfirm = async () => {
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
    <Card title="빠른 작업">
      <div className="space-y-3">
        <Link
          href="/orders"
          className="block w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-center transition-colors"
        >
          주문 목록 보기
        </Link>

        <Link
          href="/labels"
          className="block w-full py-3 px-4 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium text-center transition-colors"
        >
          라벨 생성
        </Link>

        <button
          onClick={handleConfirm}
          disabled={confirmMutation.isPending}
          className="w-full py-3 px-4 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
        >
          {confirmMutation.isPending ? '처리 중...' : '모든 주문 확인'}
        </button>

        {message && (
          <div
            className={`p-3 rounded-lg text-sm text-center ${
              message.includes('오류')
                ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
            }`}
          >
            {message}
          </div>
        )}
      </div>
    </Card>
  );
}
