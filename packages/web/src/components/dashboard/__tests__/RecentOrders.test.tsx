/**
 * RecentOrders 컴포넌트 테스트
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecentOrders } from '../RecentOrders';
import type { Order, OrdersResponse } from '@/types/api';

// useOrders hook mock
vi.mock('@/hooks/use-orders', () => ({
  useOrders: vi.fn(),
}));

// Next.js Link mock
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { useOrders } from '@/hooks/use-orders';

describe('RecentOrders', () => {
  const baseOrder: Order = {
    rowNumber: 1,
    timestamp: '2025-01-01T10:00:00Z',
    timestampRaw: '2025. 1. 1. 오전 10:00:00',
    status: '미확인',
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
  };

  it('should display loading skeleton when isLoading is true', () => {
    vi.mocked(useOrders).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as any);

    const { container } = render(<RecentOrders />);
    // RecentOrdersSkeleton이 렌더링되는지 확인 (Card title은 있어야 함)
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('should display error message when error occurs', () => {
    vi.mocked(useOrders).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Network error'),
    } as any);

    render(<RecentOrders />);
    expect(screen.getByText('주문 정보를 불러오는 중 오류가 발생했습니다.')).toBeInTheDocument();
  });

  it('should display empty state when no orders', () => {
    vi.mocked(useOrders).mockReturnValue({
      data: { success: true, orders: [], count: 0 },
      isLoading: false,
      error: null,
    } as any);

    render(<RecentOrders />);
    expect(screen.getByText('새로운 주문이 없습니다.')).toBeInTheDocument();
  });

  it('should display validation error badge and message when validationError exists', () => {
    const orderWithError: Order = {
      ...baseOrder,
      productType: null,
      validationError: '유효하지 않은 상품 타입',
    };

    vi.mocked(useOrders).mockReturnValue({
      data: { success: true, orders: [orderWithError], count: 1 },
      isLoading: false,
      error: null,
    } as any);

    render(<RecentOrders />);

    // 빨간 "오류" 배지 확인
    const errorBadge = screen.getByText('오류');
    expect(errorBadge).toBeInTheDocument();
    expect(errorBadge).toHaveClass('bg-red-100', 'text-red-700');

    // 에러 메시지 확인
    expect(screen.getByText('유효하지 않은 상품 타입')).toBeInTheDocument();
  });

  it('should display "5kg × quantity" badge when productType is 5kg', () => {
    const orderWith5kg: Order = {
      ...baseOrder,
      productType: '5kg',
      quantity: 3,
    };

    vi.mocked(useOrders).mockReturnValue({
      data: { success: true, orders: [orderWith5kg], count: 1 },
      isLoading: false,
      error: null,
    } as any);

    render(<RecentOrders />);

    // 5kg 오렌지 배지와 수량 확인
    const badge = screen.getByText('5kg × 3');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('bg-orange-100', 'text-orange-700');
  });

  it('should display "10kg × quantity" badge when productType is 10kg', () => {
    const orderWith10kg: Order = {
      ...baseOrder,
      productType: '10kg',
      quantity: 2,
    };

    vi.mocked(useOrders).mockReturnValue({
      data: { success: true, orders: [orderWith10kg], count: 1 },
      isLoading: false,
      error: null,
    } as any);

    render(<RecentOrders />);

    // 10kg 녹색 배지와 수량 확인
    const badge = screen.getByText('10kg × 2');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('bg-green-100', 'text-green-700');
  });

  it('should display "알 수 없음" badge when productType is null and no validationError', () => {
    const orderWithUnknown: Order = {
      ...baseOrder,
      productType: null,
    };

    vi.mocked(useOrders).mockReturnValue({
      data: { success: true, orders: [orderWithUnknown], count: 1 },
      isLoading: false,
      error: null,
    } as any);

    render(<RecentOrders />);

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

    vi.mocked(useOrders).mockReturnValue({
      data: { success: true, orders: [orderWithBoth], count: 1 },
      isLoading: false,
      error: null,
    } as any);

    render(<RecentOrders />);

    // validationError가 우선적으로 표시되어야 함
    expect(screen.getByText('오류')).toBeInTheDocument();
    expect(screen.queryByText('알 수 없음')).not.toBeInTheDocument();
  });

  it('should render all three states in recent orders list', () => {
    const orders: Order[] = [
      { ...baseOrder, rowNumber: 1, productType: '5kg', quantity: 1 },
      { ...baseOrder, rowNumber: 2, productType: '10kg', quantity: 2 },
      { ...baseOrder, rowNumber: 3, productType: null },
      { ...baseOrder, rowNumber: 4, productType: null, validationError: '검증 에러' },
    ];

    vi.mocked(useOrders).mockReturnValue({
      data: { success: true, orders, count: 4 },
      isLoading: false,
      error: null,
    } as any);

    render(<RecentOrders />);

    // 모든 상태가 올바르게 렌더링되는지 확인
    expect(screen.getByText('5kg × 1')).toBeInTheDocument();
    expect(screen.getByText('10kg × 2')).toBeInTheDocument();
    expect(screen.getByText('알 수 없음')).toBeInTheDocument();
    expect(screen.getByText('오류')).toBeInTheDocument();
  });
});
