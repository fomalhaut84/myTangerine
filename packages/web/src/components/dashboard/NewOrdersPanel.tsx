/**
 * 신규 주문 현황 패널
 * 처리 대기 중인 신규 주문 통계를 표시
 */

'use client';

import { useOrderStats } from '@/hooks/use-stats';
import { Card } from '@/components/common/Card';
import { Package, TrendingUp, Gift, ShoppingCart } from 'lucide-react';

export function NewOrdersPanel() {
  // scope='new'일 때는 기간 필터 없이 모든 대기 주문을 조회
  // API에서 scope='new'인 경우 range를 무시하므로 기본값만 전달
  const { data, isLoading, error } = useOrderStats({
    scope: 'new',
    metric: 'quantity',
  });

  if (isLoading) {
    return (
      <Card title="신규 주문 현황">
        <div className="animate-pulse space-y-3">
          <div className="h-16 bg-gray-200 rounded"></div>
          <div className="h-16 bg-gray-200 rounded"></div>
        </div>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card title="신규 주문 현황">
        <div className="text-gray-500 text-sm">
          데이터를 불러올 수 없습니다.
        </div>
      </Card>
    );
  }

  const { summary, sections } = data;

  // 선물 비율 계산
  const giftCount = sections?.gifts?.orderCount || 0;
  const salesCount = sections?.sales?.orderCount || 0;
  const totalCount = summary.orderCount;
  const giftRatio = totalCount > 0 ? Math.round((giftCount / totalCount) * 100) : 0;

  return (
    <Card title="신규 주문 현황">
      <div className="space-y-4">
        {/* 대기 건수 */}
        <div className="flex items-center justify-between p-4 bg-amber-50 rounded-lg">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-lg">
              <Package className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">처리 대기</p>
              <p className="text-2xl font-bold text-amber-600">
                {totalCount}건
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-600">예상 매출</p>
            <p className="text-lg font-semibold text-gray-900">
              {summary.totalRevenue.toLocaleString()}원
            </p>
          </div>
        </div>

        {/* 판매/선물 비율 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg">
            <ShoppingCart className="h-4 w-4 text-blue-600" />
            <div>
              <p className="text-xs text-gray-600">판매</p>
              <p className="text-lg font-bold text-blue-600">{salesCount}건</p>
            </div>
          </div>
          <div className="flex items-center gap-2 p-3 bg-purple-50 rounded-lg">
            <Gift className="h-4 w-4 text-purple-600" />
            <div>
              <p className="text-xs text-gray-600">선물</p>
              <p className="text-lg font-bold text-purple-600">{giftCount}건</p>
            </div>
          </div>
        </div>

        {/* 상품별 수량 */}
        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-gray-600" />
            <span className="text-sm text-gray-600">상품 구성</span>
          </div>
          <div className="flex gap-4 text-sm">
            <span className="text-orange-600 font-medium">
              5kg: {summary.total5kgQty}박스
            </span>
            <span className="text-green-600 font-medium">
              10kg: {summary.total10kgQty}박스
            </span>
          </div>
        </div>

        {/* 선물 비율 안내 */}
        {giftRatio > 0 && (
          <div className="text-xs text-gray-500 text-center">
            전체 중 선물 주문 비율: {giftRatio}%
          </div>
        )}
      </div>
    </Card>
  );
}
