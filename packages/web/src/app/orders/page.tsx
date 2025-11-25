/**
 * 주문 목록 페이지
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
import { useState, useMemo, useRef } from 'react';
import { downloadCSV, downloadExcel, getExportFilename } from '@/lib/export-utils';
import { toast } from 'sonner';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';

type SortField = 'date' | 'quantity';
type SortOrder = 'asc' | 'desc';

const ITEMS_PER_PAGE = 20;

export default function OrdersPage() {
  const { data, isLoading, error } = useOrders();
  const confirmMutation = useConfirmOrders();
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 검색, 필터, 정렬 상태
  const [searchTerm, setSearchTerm] = useState('');
  const [productTypeFilter, setProductTypeFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [currentPage, setCurrentPage] = useState(1);

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

    // 검색 필터 (이름, 주소, 전화번호)
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter((order) =>
        order.recipient.name.toLowerCase().includes(term) ||
        order.recipient.address.toLowerCase().includes(term) ||
        order.recipient.phone.includes(term)
      );
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

  // 페이지네이션 계산
  const totalPages = Math.ceil(filteredAndSortedOrders.length / ITEMS_PER_PAGE);
  const paginatedOrders = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    return filteredAndSortedOrders.slice(startIndex, endIndex);
  }, [filteredAndSortedOrders, currentPage]);

  // 필터 변경 시 페이지를 1로 리셋
  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };

  const handleProductTypeChange = (value: string) => {
    setProductTypeFilter(value);
    setCurrentPage(1);
  };

  const handleSortChange = (field?: SortField, order?: SortOrder) => {
    if (field) setSortField(field);
    if (order) setSortOrder(order);
    setCurrentPage(1);
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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-7xl mx-auto">
        {/* 헤더 */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <Link
              href="/dashboard"
              className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-200 dark:hover:text-blue-100 mb-2 inline-block"
            >
              ← 대시보드로 돌아가기
            </Link>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
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
              <label htmlFor="search" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                검색
              </label>
              <Input
                ref={searchInputRef}
                id="search"
                type="text"
                placeholder="이름, 주소, 전화번호로 검색... (/)"
                value={searchTerm}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="w-full"
              />
            </div>

            {/* 필터 및 정렬 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* 상품 타입 필터 */}
              <div>
                <label htmlFor="product-type" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
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
                <label htmlFor="sort-field" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
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
                <label htmlFor="sort-order" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
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
                <div key={i} className="h-12 bg-gray-200 dark:bg-gray-700 rounded"></div>
              ))}
            </div>
          ) : error ? (
            <div className="text-center py-12 text-red-600">
              주문 정보를 불러오는 중 오류가 발생했습니다.
            </div>
          ) : data?.success && data.orders ? (
            <>
              <div className="mb-4 text-sm text-gray-600 dark:text-gray-400">
                전체 <span className="font-semibold">{data.count}개</span> 중{' '}
                <span className="font-semibold">{filteredAndSortedOrders.length}개</span>{' '}
                (페이지 {currentPage} / {totalPages})
              </div>
              <OrdersTable orders={paginatedOrders} />

              {/* 페이지네이션 */}
              {totalPages > 1 && (
                <div className="mt-6 flex justify-center gap-2">
                  <button
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                    className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    처음
                  </button>
                  <button
                    onClick={() => setCurrentPage(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
                        onClick={() => setCurrentPage(pageNum)}
                        className={`px-3 py-2 rounded-lg border transition-colors ${
                          currentPage === pageNum
                            ? 'border-blue-600 bg-blue-600 text-white'
                            : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}

                  <button
                    onClick={() => setCurrentPage(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    다음
                  </button>
                  <button
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage === totalPages}
                    className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
