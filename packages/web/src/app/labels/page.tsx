/**
 * 라벨 관리 페이지
 */

'use client';

import { useLabels } from '@/hooks/use-labels';
import { useConfirmOrders } from '@/hooks/use-orders';
import { LabelPreview } from '@/components/labels/LabelPreview';
import { Card } from '@/components/common/Card';
import Link from 'next/link';
import { useState, useEffect, useRef } from 'react';

export default function LabelsPage() {
  const { data: labelText, isLoading, error } = useLabels();
  const confirmMutation = useConfirmOrders();
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout>();
  const copyTimeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  // 실제 라벨 데이터가 있는지 확인 (API가 주문 없음 메시지를 반환하지 않는지)
  const hasLabels = labelText && labelText !== '새로운 주문이 없습니다.';

  const handleCopy = async () => {
    if (!hasLabels) return;

    try {
      await navigator.clipboard.writeText(labelText);
      setCopied(true);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      alert('클립보드 복사에 실패했습니다.');
    }
  };

  const handlePrint = () => {
    if (!hasLabels) return;
    window.print();
  };

  const handleConfirm = async () => {
    if (!hasLabels) return;

    if (!confirm('라벨을 출력하고 모든 주문을 확인 처리하시겠습니까?')) {
      return;
    }

    try {
      const result = await confirmMutation.mutateAsync();
      setMessage(result.message);
      timeoutRef.current = setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      setMessage('주문 확인 처리 중 오류가 발생했습니다.');
      timeoutRef.current = setTimeout(() => setMessage(null), 3000);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-4xl mx-auto">
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

        {/* 액션 버튼 */}
        <div className="mb-6 flex gap-3">
          <button
            onClick={handleCopy}
            disabled={!hasLabels}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
          >
            {copied ? '복사됨!' : '클립보드에 복사'}
          </button>

          <button
            onClick={handlePrint}
            disabled={!hasLabels}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
          >
            출력
          </button>

          <button
            onClick={handleConfirm}
            disabled={confirmMutation.isPending || !hasLabels}
            className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
          >
            {confirmMutation.isPending
              ? '처리 중...'
              : '출력 후 주문 확인'}
          </button>
        </div>

        {/* 라벨 프리뷰 */}
        <Card title="라벨 프리뷰">
          {isLoading ? (
            <div className="animate-pulse space-y-4">
              {[...Array(10)].map((_, i) => (
                <div key={i} className="h-4 bg-gray-200 dark:bg-gray-700 rounded"></div>
              ))}
            </div>
          ) : error ? (
            <div className="text-center py-12 text-red-600">
              라벨 정보를 불러오는 중 오류가 발생했습니다.
            </div>
          ) : hasLabels ? (
            <LabelPreview labelText={labelText} />
          ) : (
            <div className="text-center py-12 text-gray-500">
              생성할 라벨이 없습니다.
            </div>
          )}
        </Card>

        {/* 출력용 스타일 */}
        {hasLabels && (
          <>
            <style jsx global>{`
              @media print {
                body * {
                  visibility: hidden;
                }
                .print-area,
                .print-area * {
                  visibility: visible;
                  display: block !important;
                }
                .print-area {
                  position: absolute;
                  left: 0;
                  top: 0;
                  width: 100%;
                  font-family: monospace;
                  font-size: 12pt;
                  white-space: pre-wrap;
                }
              }
            `}</style>
            <div className="print-area hidden">
              {labelText}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
