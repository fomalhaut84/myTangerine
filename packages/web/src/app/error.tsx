/**
 * 전역 에러 페이지
 */

'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Global error:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-8">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8">
        <h2 className="text-2xl font-bold text-red-600 dark:text-red-400 mb-4">
          오류가 발생했습니다
        </h2>
        <p className="text-gray-700 dark:text-gray-300 mb-6">
          예상치 못한 오류가 발생했습니다. 잠시 후 다시 시도해주세요.
        </p>
        {error.message && (
          <details className="mb-6 text-sm text-gray-600 dark:text-gray-400">
            <summary className="cursor-pointer hover:underline mb-2">
              오류 상세 정보
            </summary>
            <pre className="p-4 bg-gray-100 dark:bg-gray-700 rounded overflow-auto">
              {error.message}
            </pre>
          </details>
        )}
        <div className="flex gap-4">
          <button
            onClick={reset}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            다시 시도
          </button>
          <button
            onClick={() => (window.location.href = '/')}
            className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            홈으로 이동
          </button>
        </div>
      </div>
    </div>
  );
}
