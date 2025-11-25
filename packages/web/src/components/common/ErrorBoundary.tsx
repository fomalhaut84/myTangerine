/**
 * 에러 바운더리 컴포넌트
 * React 컴포넌트 트리에서 발생하는 JavaScript 에러를 잡아서 처리
 */

'use client';

import React from 'react';
import { Card } from '@/components/common/Card';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <Card title="오류가 발생했습니다">
          <div className="space-y-4">
            <div className="text-red-600 dark:text-red-400">
              예상치 못한 오류가 발생했습니다. 페이지를 새로고침하거나 잠시 후 다시
              시도해주세요.
            </div>
            {this.state.error && (
              <details className="text-sm text-gray-600 dark:text-gray-400">
                <summary className="cursor-pointer hover:underline">
                  오류 상세 정보
                </summary>
                <pre className="mt-2 p-4 bg-gray-100 dark:bg-gray-800 rounded overflow-auto">
                  {this.state.error.message}
                </pre>
              </details>
            )}
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              페이지 새로고침
            </button>
          </div>
        </Card>
      );
    }

    return this.props.children;
  }
}
