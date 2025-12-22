/**
 * 주문 상태 배지 컴포넌트
 */

'use client';

import type { OrderStatus } from '@/types/api';

interface StatusBadgeProps {
  status: OrderStatus;
  isDeleted?: boolean;
  size?: 'sm' | 'md';
}

/**
 * 상태별 스타일 정의
 */
const statusStyles: Record<OrderStatus, { bg: string; text: string; label: string }> = {
  '신규주문': {
    bg: 'bg-gray-100',
    text: 'text-gray-700',
    label: '신규주문',
  },
  '입금확인': {
    bg: 'bg-blue-100',
    text: 'text-blue-700',
    label: '입금확인',
  },
  '배송완료': {
    bg: 'bg-green-100',
    text: 'text-green-700',
    label: '배송완료',
  },
};

/**
 * 삭제된 주문 스타일
 */
const deletedStyle = {
  bg: 'bg-red-100',
  text: 'text-red-700',
  label: '삭제됨',
};

export function StatusBadge({ status, isDeleted = false, size = 'sm' }: StatusBadgeProps) {
  const style = isDeleted ? deletedStyle : statusStyles[status];

  const sizeClasses = size === 'sm'
    ? 'px-2 py-0.5 text-xs'
    : 'px-3 py-1 text-sm';

  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${style.bg} ${style.text} ${sizeClasses} ${isDeleted ? 'line-through' : ''}`}
    >
      {style.label}
    </span>
  );
}
