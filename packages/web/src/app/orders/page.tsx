/**
 * 주문 목록 페이지 (서버 컴포넌트)
 */

import { Suspense } from 'react';
import { OrdersPageContent } from './OrdersPageContent';

export default function OrdersPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="max-w-7xl mx-auto">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-200 rounded w-1/4"></div>
            <div className="h-64 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    }>
      <OrdersPageContent />
    </Suspense>
  );
}
