/**
 * 빠른 액션 버튼 컴포넌트
 * Issue #112: KPI Alerts 기능 추가
 */

'use client';

import Link from 'next/link';
import { useSyncData } from '@/hooks/use-sync';
import { useOrderStats } from '@/hooks/use-stats';
import { useOrdersSummary } from '@/hooks/use-orders';
import { Card } from '@/components/common/Card';
import { useState, useEffect, useRef, useMemo } from 'react';
import { AlertTriangle, TrendingDown, PackageX } from 'lucide-react';
import type { KPIAlert } from '@/types/api';

/** MoM 감소 임계값 (%) */
const MOM_DECLINE_THRESHOLD = -10;

export function QuickActions() {
  const syncMutation = useSyncData();
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncErrors, setSyncErrors] = useState<Array<{ rowNumber: number; error: string }> | null>(null);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // KPI 데이터 조회
  const { data: newOrdersData } = useOrdersSummary();
  const { data: trendData } = useOrderStats({
    scope: 'completed',
    range: '6m',
    metric: 'amount',
  });

  // KPI Alerts 계산
  const alerts = useMemo(() => {
    const result: KPIAlert[] = [];

    // 1. 신규 주문 없음 알림
    const newOrderCount = newOrdersData?.summary
      ? newOrdersData.summary['5kg'].count + newOrdersData.summary['10kg'].count
      : 0;

    if (newOrdersData?.success && newOrderCount === 0) {
      result.push({
        type: 'info',
        title: '신규 주문 없음',
        message: '처리 대기 중인 신규 주문이 없습니다.',
      });
    }

    // 2. MoM 감소 경고
    const latestSeries = trendData?.series?.slice(-1)[0];
    const momGrowthPct = latestSeries?.momGrowthPct;

    if (momGrowthPct !== null && momGrowthPct !== undefined && momGrowthPct < MOM_DECLINE_THRESHOLD) {
      result.push({
        type: 'warning',
        title: '매출 감소 경고',
        message: `전월 대비 매출이 ${momGrowthPct.toFixed(1)}% 감소했습니다.`,
      });
    }

    return result;
  }, [newOrdersData, trendData]);

  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, []);

  const handleSync = async () => {
    // codex-cli 리뷰: 기존 타이머를 정리하여 중첩 방지
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }

    try {
      const result = await syncMutation.mutateAsync();
      setSyncMessage(result.message);

      // 실패한 행이 있으면 에러 목록 표시
      if (result.result.errors.length > 0) {
        setSyncErrors(result.result.errors);
      } else {
        setSyncErrors(null);
      }

      syncTimeoutRef.current = setTimeout(() => {
        setSyncMessage(null);
        setSyncErrors(null);
      }, 10000); // 에러가 있으면 10초 표시
    } catch (error) {
      setSyncMessage('데이터 동기화 중 오류가 발생했습니다.');
      setSyncErrors(null);
      syncTimeoutRef.current = setTimeout(() => setSyncMessage(null), 5000);
    }
  };

  /** Alert 아이콘 선택 */
  const getAlertIcon = (type: KPIAlert['type']) => {
    switch (type) {
      case 'warning':
        return <TrendingDown className="h-4 w-4" />;
      case 'info':
        return <PackageX className="h-4 w-4" />;
      default:
        return <AlertTriangle className="h-4 w-4" />;
    }
  };

  /** Alert 스타일 */
  const getAlertStyle = (type: KPIAlert['type']) => {
    switch (type) {
      case 'warning':
        return 'bg-amber-50 border-amber-200 text-amber-800';
      case 'info':
        return 'bg-blue-50 border-blue-200 text-blue-700';
      default:
        return 'bg-green-50 border-green-200 text-green-700';
    }
  };

  return (
    <Card title="빠른 작업">
      <div className="space-y-3">
        {/* KPI Alerts */}
        {alerts.length > 0 && (
          <div className="space-y-2 pb-3 border-b border-gray-200">
            {alerts.map((alert, idx) => (
              <div
                key={idx}
                className={`flex items-start gap-2 p-2 rounded-lg border ${getAlertStyle(alert.type)}`}
              >
                <span className="mt-0.5 flex-shrink-0">{getAlertIcon(alert.type)}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{alert.title}</p>
                  <p className="text-xs opacity-80">{alert.message}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        <Link
          href="/orders"
          className="block w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-center transition-colors"
        >
          주문 목록 보기
        </Link>

        <Link
          href="/labels"
          className="block w-full py-3 px-4 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium text-center transition-colors"
        >
          라벨 생성
        </Link>

        <button
          onClick={handleSync}
          disabled={syncMutation.isPending}
          className="w-full py-3 px-4 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
        >
          {syncMutation.isPending ? '동기화 중...' : '데이터 동기화'}
        </button>

        {syncMessage && (
          <div
            className={`p-3 rounded-lg text-sm ${
              syncMessage.includes('오류')
                ? 'bg-red-100 text-red-700'
                : syncErrors && syncErrors.length > 0
                ? 'bg-yellow-100 text-yellow-800'
                : 'bg-green-100 text-green-700'
            }`}
          >
            <div className="text-center">{syncMessage}</div>

            {/* 실패한 행 목록 표시 */}
            {syncErrors && syncErrors.length > 0 && (
              <div className="mt-3 max-h-48 overflow-y-auto">
                <div className="text-xs font-semibold mb-2">실패한 행:</div>
                <div className="space-y-1">
                  {syncErrors.map((err, idx) => (
                    <div key={idx} className="text-xs bg-white bg-opacity-50 p-2 rounded">
                      <span className="font-semibold">행 {err.rowNumber}:</span> {err.error}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
