/**
 * 주문 테이블 컴포넌트
 */

'use client';

import type { Order } from '@/types/api';
import { useRouter } from 'next/navigation';
import { StatusBadge } from './StatusBadge';

interface OrdersTableProps {
  orders: Order[];
  searchParams?: URLSearchParams;
  showDeleted?: boolean;
}

export function OrdersTable({ orders, searchParams, showDeleted = false }: OrdersTableProps) {
  const router = useRouter();

  if (orders.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        {showDeleted ? '삭제된 주문이 없습니다.' : '주문이 없습니다.'}
      </div>
    );
  }

  const handleRowClick = (orderId: number) => {
    const queryString = searchParams?.toString();
    const url = queryString
      ? `/orders/${orderId}?${queryString}`
      : `/orders/${orderId}`;
    router.push(url);
  };

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              상태
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              타임스탬프
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              받는 사람
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              주소
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              연락처
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              상품
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              수량
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {orders.map((order) => (
            <tr
              key={order.rowNumber}
              onClick={() => handleRowClick(order.rowNumber)}
              className={`hover:bg-gray-50 transition-colors cursor-pointer ${order.isDeleted ? 'opacity-60' : ''}`}
            >
              <td className="px-6 py-4 whitespace-nowrap">
                <StatusBadge status={order.status} isDeleted={order.isDeleted} />
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                {new Date(order.timestamp).toLocaleString('ko-KR', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </td>
              <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 ${order.isDeleted ? 'line-through' : ''}`}>
                {order.recipient.name}
              </td>
              <td className={`px-6 py-4 text-sm text-gray-600 max-w-xs truncate ${order.isDeleted ? 'line-through' : ''}`}>
                {order.recipient.address}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                {order.recipient.phone}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                {order.validationError ? (
                  <span className="inline-block px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-700">
                    오류: {order.validationError}
                  </span>
                ) : order.productType ? (
                  <span
                    className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${
                      order.productType === '5kg'
                        ? 'bg-orange-100 text-orange-700'
                        : 'bg-green-100 text-green-700'
                    }`}
                  >
                    {order.productType}
                  </span>
                ) : (
                  <span className="inline-block px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-700">
                    알 수 없음
                  </span>
                )}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                {order.quantity}박스
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
