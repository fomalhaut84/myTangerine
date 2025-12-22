/**
 * 빠른 액션 버튼 컴포넌트
 */

'use client';

import Link from 'next/link';
import { useSyncData } from '@/hooks/use-sync';
import { Card } from '@/components/common/Card';
import { useState, useEffect, useRef } from 'react';

export function QuickActions() {
  const syncMutation = useSyncData();
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncErrors, setSyncErrors] = useState<Array<{ rowNumber: number; error: string }> | null>(null);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, []);

  const handleSync = async () => {
    try {
      const result = await syncMutation.mutateAsync();
      setSyncMessage(result.message);

      // 실패한 행이 있으면 에러 목록 표시
      if (result.result.errors.length > 0) {
        setSyncErrors(result.result.errors);
      } else {
        setSyncErrors(null);
      }

      syncTimeoutRef.current = setTimeout(() => {
        setSyncMessage(null);
        setSyncErrors(null);
      }, 10000); // 에러가 있으면 10초 표시
    } catch (error) {
      setSyncMessage('데이터 동기화 중 오류가 발생했습니다.');
      setSyncErrors(null);
      syncTimeoutRef.current = setTimeout(() => setSyncMessage(null), 5000);
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
          onClick={handleSync}
          disabled={syncMutation.isPending}
          className="w-full py-3 px-4 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
        >
          {syncMutation.isPending ? '동기화 중...' : '데이터 동기화'}
        </button>

        {syncMessage && (
          <div
            className={`p-3 rounded-lg text-sm ${
              syncMessage.includes('오류')
                ? 'bg-red-100 text-red-700'
                : syncErrors && syncErrors.length > 0
                ? 'bg-yellow-100 text-yellow-800'
                : 'bg-green-100 text-green-700'
            }`}
          >
            <div className="text-center">{syncMessage}</div>

            {/* 실패한 행 목록 표시 */}
            {syncErrors && syncErrors.length > 0 && (
              <div className="mt-3 max-h-48 overflow-y-auto">
                <div className="text-xs font-semibold mb-2">실패한 행:</div>
                <div className="space-y-1">
                  {syncErrors.map((err, idx) => (
                    <div key={idx} className="text-xs bg-white bg-opacity-50 p-2 rounded">
                      <span className="font-semibold">행 {err.rowNumber}:</span> {err.error}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
