/**
 * 주문 목록 페이지 컨텐츠 (클라이언트 컴포넌트)
 */

'use client';

import { useOrders, useConfirmOrders } from '@/hooks/use-orders';
import { OrdersTable } from '@/components/orders/OrdersTable';
import { Card } from '@/components/common/Card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Link from 'next/link';
import { useMemo, useRef, useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { downloadCSV, downloadExcel, getExportFilename } from '@/lib/export-utils';
import { toast } from 'sonner';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';

type SortField = 'date' | 'quantity';
type SortOrder = 'asc' | 'desc';
type StatusFilter = 'new' | 'completed' | 'all';

const ITEMS_PER_PAGE = 20;
const SEARCH_DEBOUNCE_MS = 500;

export function OrdersPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // URL 쿼리 파라미터에서 초기값 읽기
  const statusFilter = (searchParams.get('status') as StatusFilter) || 'new';
  const searchTerm = (searchParams.get('search') || '').trim();
  const productTypeFilter = searchParams.get('productType') || 'all';
  const sortField = (searchParams.get('sortField') as SortField) || 'date';
  const sortOrder = (searchParams.get('sortOrder') as SortOrder) || 'desc';
  const rawPage = parseInt(searchParams.get('page') || '1', 10);

  // 로컬 검색어 상태 (즉시 반응)
  const [searchInput, setSearchInput] = useState(searchTerm);

  const { data, isLoading, error } = useOrders(statusFilter);
  const confirmMutation = useConfirmOrders();
  const searchInputRef = useRef<HTMLInputElement>(null);

  // URL 쿼리 파라미터 업데이트 헬퍼 함수
  const updateQueryParams = (updates: Record<string, string | number>) => {
    const params = new URLSearchParams(searchParams.toString());

    Object.entries(updates).forEach(([key, value]) => {
      // 빈 값이거나, productType이 'all'이거나, page가 1인 경우 삭제
      // 주의: status='all'은 유효한 값이므로 삭제하지 않음
      if (value === '' || (key === 'productType' && value === 'all') || (key === 'page' && value === 1)) {
        params.delete(key);
      } else {
        params.set(key, String(value));
      }
    });

    router.push(`/orders?${params.toString()}`, { scroll: false });
  };

  // URL 검색어와 로컬 검색어 동기화
  useEffect(() => {
    setSearchInput(searchTerm);
  }, [searchTerm]);

  // 검색어 디바운스
  useEffect(() => {
    const timer = setTimeout(() => {
      const trimmedInput = searchInput.trim();
      if (trimmedInput !== searchTerm) {
        updateQueryParams({ search: trimmedInput, page: 1 });
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  // 키보드 단축키
  useKeyboardShortcuts([
    {
      key: '/',
      action: () => searchInputRef.current?.focus(),
      description: '/: 검색 포커스',
    },
  ]);

  // 검색, 필터, 정렬이 적용된 주문 목록
  const filteredAndSortedOrders = useMemo(() => {
    if (!data?.orders) return [];

    let filtered = data.orders;

    // 검색 필터 (수취인 + 발송인 이름, 주소, 전화번호)
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter((order) => {
        // 소문자 변환을 한 번만 수행 (성능 최적화)
        const recipientName = order.recipient.name.toLowerCase();
        const recipientAddress = order.recipient.address.toLowerCase();
        const senderName = order.sender.name.toLowerCase();
        const senderAddress = order.sender.address.toLowerCase();

        return (
          recipientName.includes(term) ||
          recipientAddress.includes(term) ||
          order.recipient.phone.includes(term) ||
          senderName.includes(term) ||
          senderAddress.includes(term) ||
          order.sender.phone.includes(term)
        );
      });
    }

    // 상품 타입 필터
    if (productTypeFilter !== 'all') {
      filtered = filtered.filter((order) => order.productType === productTypeFilter);
    }

    // 정렬
    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0;

      if (sortField === 'date') {
        comparison = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      } else if (sortField === 'quantity') {
        comparison = a.quantity - b.quantity;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return sorted;
  }, [data?.orders, searchTerm, productTypeFilter, sortField, sortOrder]);

  // 페이지네이션 계산 (최소 1페이지 보장)
  const totalPages = Math.max(1, Math.ceil(filteredAndSortedOrders.length / ITEMS_PER_PAGE));

  // currentPage 범위 검증 (NaN, 음수, totalPages 초과 방지)
  const currentPage = useMemo(() => {
    if (isNaN(rawPage) || rawPage < 1) return 1;
    if (rawPage > totalPages) return totalPages;
    return rawPage;
  }, [rawPage, totalPages]);

  // currentPage와 rawPage 동기화 (URL 정규화)
  useEffect(() => {
    if (currentPage !== rawPage) {
      updateQueryParams({ page: currentPage });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, rawPage]);

  const paginatedOrders = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    return filteredAndSortedOrders.slice(startIndex, endIndex);
  }, [filteredAndSortedOrders, currentPage]);

  // 검색어 입력 (로컬 상태 업데이트, 디바운스 후 URL 반영)
  const handleSearchChange = (value: string) => {
    setSearchInput(value);
  };

  const handleStatusChange = (value: StatusFilter) => {
    updateQueryParams({ status: value, page: 1 });
  };

  const handleProductTypeChange = (value: string) => {
    updateQueryParams({ productType: value, page: 1 });
  };

  const handleSortChange = (field?: SortField, order?: SortOrder) => {
    const updates: Record<string, string> = { page: '1' };
    if (field) updates.sortField = field;
    if (order) updates.sortOrder = order;
    updateQueryParams(updates);
  };

  const handlePageChange = (page: number) => {
    updateQueryParams({ page });
  };

  const handleConfirm = async () => {
    if (!confirm('모든 주문을 확인 처리하시겠습니까?')) {
      return;
    }

    try {
      const result = await confirmMutation.mutateAsync();
      toast.success(result.message);
    } catch (error) {
      toast.error('주문 확인 처리 중 오류가 발생했습니다.');
    }
  };

  const handleDownloadCSV = () => {
    if (filteredAndSortedOrders.length === 0) {
      toast.error('다운로드할 주문이 없습니다.');
      return;
    }

    const filename = getExportFilename('주문목록', 'csv');
    downloadCSV(filteredAndSortedOrders, filename);
    toast.success(`${filteredAndSortedOrders.length}개의 주문을 CSV로 다운로드했습니다.`);
  };

  const handleDownloadExcel = () => {
    if (filteredAndSortedOrders.length === 0) {
      toast.error('다운로드할 주문이 없습니다.');
      return;
    }

    const filename = getExportFilename('주문목록', 'xlsx');
    downloadExcel(filteredAndSortedOrders, filename);
    toast.success(`${filteredAndSortedOrders.length}개의 주문을 Excel로 다운로드했습니다.`);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* 헤더 */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <Link
              href="/dashboard"
              className="text-sm text-blue-600 hover:text-blue-700 mb-2 inline-block"
            >
              ← 대시보드로 돌아가기
            </Link>
            <h1 className="text-3xl font-bold text-gray-900">
              주문 목록
            </h1>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleDownloadCSV}
              disabled={
                !data?.orders ||
                data.orders.length === 0 ||
                filteredAndSortedOrders.length === 0
              }
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
            >
              CSV 다운로드
            </button>

            <button
              onClick={handleDownloadExcel}
              disabled={
                !data?.orders ||
                data.orders.length === 0 ||
                filteredAndSortedOrders.length === 0
              }
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
            >
              Excel 다운로드
            </button>

            <Link
              href="/labels"
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
            >
              라벨 생성
            </Link>

            <button
              onClick={handleConfirm}
              disabled={
                confirmMutation.isPending ||
                !data?.orders ||
                data.orders.length === 0
              }
              className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
            >
              {confirmMutation.isPending ? '처리 중...' : '모두 확인'}
            </button>
          </div>
        </div>

        {/* 검색 및 필터 */}
        <Card className="mb-6">
          <div className="space-y-4">
            {/* 검색 */}
            <div>
              <label htmlFor="search" className="block text-sm font-medium text-gray-700 mb-2">
                검색
              </label>
              <Input
                ref={searchInputRef}
                id="search"
                type="text"
                placeholder="이름, 주소, 전화번호로 검색... (/)"
                value={searchInput}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="w-full"
              />
            </div>

            {/* 필터 및 정렬 */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* 주문 상태 필터 */}
              <div>
                <label htmlFor="status-filter" className="block text-sm font-medium text-gray-700 mb-2">
                  주문 상태
                </label>
                <Select value={statusFilter} onValueChange={handleStatusChange}>
                  <SelectTrigger id="status-filter">
                    <SelectValue placeholder="신규 주문" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">신규 주문</SelectItem>
                    <SelectItem value="completed">완료된 주문</SelectItem>
                    <SelectItem value="all">전체</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* 상품 타입 필터 */}
              <div>
                <label htmlFor="product-type" className="block text-sm font-medium text-gray-700 mb-2">
                  상품 타입
                </label>
                <Select value={productTypeFilter} onValueChange={handleProductTypeChange}>
                  <SelectTrigger id="product-type">
                    <SelectValue placeholder="전체" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">전체</SelectItem>
                    <SelectItem value="5kg">5kg</SelectItem>
                    <SelectItem value="10kg">10kg</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* 정렬 기준 */}
              <div>
                <label htmlFor="sort-field" className="block text-sm font-medium text-gray-700 mb-2">
                  정렬 기준
                </label>
                <Select value={sortField} onValueChange={(value) => handleSortChange(value as SortField, undefined)}>
                  <SelectTrigger id="sort-field">
                    <SelectValue placeholder="날짜" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="date">날짜</SelectItem>
                    <SelectItem value="quantity">수량</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* 정렬 순서 */}
              <div>
                <label htmlFor="sort-order" className="block text-sm font-medium text-gray-700 mb-2">
                  정렬 순서
                </label>
                <Select value={sortOrder} onValueChange={(value) => handleSortChange(undefined, value as SortOrder)}>
                  <SelectTrigger id="sort-order">
                    <SelectValue placeholder="내림차순" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="desc">내림차순</SelectItem>
                    <SelectItem value="asc">오름차순</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </Card>

        {/* 주문 테이블 */}
        <Card>
          {isLoading ? (
            <div className="animate-pulse space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 bg-gray-200 rounded"></div>
              ))}
            </div>
          ) : error ? (
            <div className="text-center py-12 text-red-600">
              주문 정보를 불러오는 중 오류가 발생했습니다.
            </div>
          ) : data?.success && data.orders ? (
            <>
              <div className="mb-4 text-sm text-gray-600">
                전체 <span className="font-semibold">{data.count}개</span> 중{' '}
                <span className="font-semibold">{filteredAndSortedOrders.length}개</span>{' '}
                (페이지 {currentPage} / {totalPages})
              </div>
              <OrdersTable orders={paginatedOrders} searchParams={searchParams} />

              {/* 페이지네이션 */}
              {totalPages > 1 && (
                <div className="mt-6 flex justify-center gap-2">
                  <button
                    onClick={() => handlePageChange(1)}
                    disabled={currentPage === 1}
                    className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    처음
                  </button>
                  <button
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    이전
                  </button>

                  {/* 페이지 번호 */}
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }

                    return (
                      <button
                        key={pageNum}
                        onClick={() => handlePageChange(pageNum)}
                        className={`px-3 py-2 rounded-lg border transition-colors ${
                          currentPage === pageNum
                            ? 'border-blue-600 bg-blue-600 text-white'
                            : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}

                  <button
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    다음
                  </button>
                  <button
                    onClick={() => handlePageChange(totalPages)}
                    disabled={currentPage === totalPages}
                    className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    마지막
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-12 text-gray-500">
              주문이 없습니다.
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
