/**
 * OrdersTable 컴포넌트 테스트
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrdersTable } from '../OrdersTable';
import type { Order } from '@/types/api';

// Next.js router mock
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

describe('OrdersTable', () => {
  const baseOrder: Order = {
    rowNumber: 1,
    timestamp: '2025-01-01T10:00:00Z',
    timestampRaw: '2025. 1. 1. 오전 10:00:00',
    status: '신규주문',
    sender: {
      name: '발송자',
      phone: '010-1234-5678',
      address: '발송지 주소',
    },
    recipient: {
      name: '수령자',
      phone: '010-9876-5432',
      address: '수령지 주소',
    },
    quantity: 2,
    productType: '5kg',
    orderType: 'customer',
    isDeleted: false,
  };

  it('should render empty state when no orders', () => {
    render(<OrdersTable orders={[]} />);
    expect(screen.getByText('주문이 없습니다.')).toBeInTheDocument();
  });

  it('should display validation error with red badge when validationError exists', () => {
    const orderWithError: Order = {
      ...baseOrder,
      productType: null,
      validationError: '유효하지 않은 상품 타입: "3kg"',
    };

    render(<OrdersTable orders={[orderWithError]} />);

    // 빨간 배지와 오류 메시지 확인
    const errorBadge = screen.getByText(/오류:/);
    expect(errorBadge).toBeInTheDocument();
    expect(errorBadge).toHaveClass('bg-red-100', 'text-red-700');
    expect(screen.getByText(/유효하지 않은 상품 타입/)).toBeInTheDocument();
  });

  it('should display "5kg" badge when productType is 5kg', () => {
    const orderWith5kg: Order = {
      ...baseOrder,
      productType: '5kg',
    };

    render(<OrdersTable orders={[orderWith5kg]} />);

    // 5kg 오렌지 배지 확인
    const badge = screen.getByText('5kg');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('bg-orange-100', 'text-orange-700');
  });

  it('should display "10kg" badge when productType is 10kg', () => {
    const orderWith10kg: Order = {
      ...baseOrder,
      productType: '10kg',
    };

    render(<OrdersTable orders={[orderWith10kg]} />);

    // 10kg 녹색 배지 확인
    const badge = screen.getByText('10kg');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('bg-green-100', 'text-green-700');
  });

  it('should display "알 수 없음" badge when productType is null and no validationError', () => {
    const orderWithUnknown: Order = {
      ...baseOrder,
      productType: null,
    };

    render(<OrdersTable orders={[orderWithUnknown]} />);

    // 회색 "알 수 없음" 배지 확인
    const badge = screen.getByText('알 수 없음');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('bg-gray-100', 'text-gray-700');
  });

  it('should prioritize validationError over null productType', () => {
    const orderWithBoth: Order = {
      ...baseOrder,
      productType: null,
      validationError: '검증 실패',
    };

    render(<OrdersTable orders={[orderWithBoth]} />);

    // validationError가 우선적으로 표시되어야 함
    expect(screen.getByText(/오류:/)).toBeInTheDocument();
    expect(screen.getByText(/검증 실패/)).toBeInTheDocument();
    expect(screen.queryByText('알 수 없음')).not.toBeInTheDocument();
  });

  it('should render all three states in a single table', () => {
    const orders: Order[] = [
      { ...baseOrder, rowNumber: 1, productType: '5kg' },
      { ...baseOrder, rowNumber: 2, productType: '10kg' },
      { ...baseOrder, rowNumber: 3, productType: null },
      { ...baseOrder, rowNumber: 4, productType: null, validationError: '검증 에러' },
    ];

    render(<OrdersTable orders={orders} />);

    // 모든 상태가 올바르게 렌더링되는지 확인
    expect(screen.getByText('5kg')).toBeInTheDocument();
    expect(screen.getByText('10kg')).toBeInTheDocument();
    expect(screen.getByText('알 수 없음')).toBeInTheDocument();
    expect(screen.getByText(/오류:/)).toBeInTheDocument();
  });
});
