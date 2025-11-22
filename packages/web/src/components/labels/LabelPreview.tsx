/**
 * 라벨 프리뷰 컴포넌트
 */

'use client';

interface LabelPreviewProps {
  labelText: string;
}

export function LabelPreview({ labelText }: LabelPreviewProps) {
  return (
    <div className="bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-700 rounded-lg p-6 font-mono text-sm overflow-auto max-h-[600px]">
      <pre className="whitespace-pre-wrap break-words text-gray-900 dark:text-gray-100">
        {labelText}
      </pre>
    </div>
  );
}
