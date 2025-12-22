/**
 * 누적 수량/매출 Area Chart
 * Issue #134: 모바일 반응형 차트 개선
 */

'use client';

import { useState, useEffect } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useMediaQuery } from '@/hooks/use-media-query';

interface MonthlyStats {
  period: string;
  total5kgQty: number;
  total10kgQty: number;
  total5kgAmount: number;
  total10kgAmount: number;
  orderCount: number;
  avgOrderAmount: number;
  momGrowthPct: number | null;
}

interface AreaChartStatsProps {
  data: MonthlyStats[];
  metric: 'quantity' | 'amount';
}

export function AreaChartStats({ data, metric }: AreaChartStatsProps) {
  const [mounted, setMounted] = useState(false);
  const isQuantity = metric === 'quantity';
  const isMobile = useMediaQuery('(max-width: 639px)');

  useEffect(() => {
    // DOM이 완전히 준비된 후 차트 렌더링
    const timer = setTimeout(() => {
      setMounted(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // Transform data to calculate cumulative values
  const chartData = data.reduce((acc, item, index) => {
    const current5kg = isQuantity ? item.total5kgQty : item.total5kgAmount;
    const current10kg = isQuantity ? item.total10kgQty : item.total10kgAmount;
    const currentTotal = current5kg + current10kg;
    const prevCumulative = index > 0 ? acc[index - 1].cumulative5kg + acc[index - 1].cumulative10kg : 0;

    // Add year markers for better context
    const [year, month] = item.period.split('-');
    const prevYear = index > 0 ? data[index - 1].period.split('-')[0] : year;
    const isLastItem = index === data.length - 1;
    // 첫 번째 항목이거나, 이전 달과 연도가 다르거나, 1월이거나, 마지막 항목이면 연도 포함
    const shouldShowYear = index === 0 || year !== prevYear || month === '01' || isLastItem;
    const monthLabel = shouldShowYear ? `${year.substring(2)}.${month}` : month;

    acc.push({
      month: monthLabel,
      fullDate: item.period,
      cumulative5kg: (index > 0 ? acc[index - 1].cumulative5kg : 0) + current5kg,
      cumulative10kg: (index > 0 ? acc[index - 1].cumulative10kg : 0) + current10kg,
      cumulativeTotal: prevCumulative + currentTotal,
      monthValue: currentTotal,
    });

    return acc;
  }, [] as Array<{
    month: string;
    fullDate: string;
    cumulative5kg: number;
    cumulative10kg: number;
    cumulativeTotal: number;
    monthValue: number;
  }>);

  return (
    <div className="h-64 sm:h-[350px]">
      {mounted ? (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={isMobile
              ? { top: 5, right: 10, left: 0, bottom: 5 }
              : { top: 5, right: 30, left: 20, bottom: 5 }
            }
          >
            <defs>
              <linearGradient id="color5kg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f97316" stopOpacity={0.8} />
                <stop offset="95%" stopColor="#f97316" stopOpacity={0.1} />
              </linearGradient>
              <linearGradient id="color10kg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.8} />
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="month"
              className="text-xs"
              tick={{ fontSize: isMobile ? 10 : 12 }}
            />
            <YAxis
              className="text-xs"
              tick={{ fontSize: isMobile ? 10 : 12 }}
              width={isMobile ? 35 : 60}
              tickFormatter={(value) => {
                if (isQuantity) {
                  return value.toLocaleString();
                }
                // 금액: 만 단위로 표시 (다른 차트와 일관성)
                return (value / 10000).toFixed(0);
              }}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;

                const data = payload[0].payload;
                const unit = isQuantity ? '박스' : '원';
                const label = isQuantity ? '수량' : '매출';

                return (
                  <div className="bg-background border rounded-lg shadow-lg p-2 sm:p-3">
                    <p className="font-semibold text-xs sm:text-sm mb-1 sm:mb-2">{data.fullDate}</p>
                    <div className="space-y-1 text-xs">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 sm:w-3 sm:h-3 rounded-full bg-orange-500" />
                        <span>5kg 누적: {data.cumulative5kg.toLocaleString()}{unit}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 sm:w-3 sm:h-3 rounded-full bg-green-500" />
                        <span>10kg 누적: {data.cumulative10kg.toLocaleString()}{unit}</span>
                      </div>
                      <div className="pt-1 mt-1 border-t">
                        <span className="font-semibold">
                          총 누적: {data.cumulativeTotal.toLocaleString()}{unit}
                        </span>
                      </div>
                      <div className="text-muted-foreground">
                        월 {label}: {data.monthValue.toLocaleString()}{unit}
                      </div>
                    </div>
                  </div>
                );
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: isMobile ? '12px' : '14px' }}
              formatter={(value) => {
                const labels: Record<string, string> = {
                  cumulative5kg: '5kg 누적',
                  cumulative10kg: '10kg 누적',
                };
                return labels[value] || value;
              }}
            />
            <Area
              type="monotone"
              dataKey="cumulative5kg"
              stackId="1"
              stroke="#f97316"
              fill="url(#color5kg)"
              name="5kg"
            />
            <Area
              type="monotone"
              dataKey="cumulative10kg"
              stackId="1"
              stroke="#22c55e"
              fill="url(#color10kg)"
              name="10kg"
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex items-center justify-center h-full">
          <div className="text-muted-foreground">차트 로딩 중...</div>
        </div>
      )}
    </div>
  );
}
