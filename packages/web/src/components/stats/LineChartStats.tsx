/**
 * 월별 주문 추세 Line Chart
 * Issue #134: 모바일 반응형 차트 개선
 */

'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/common/Card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { MonthlyStatsSeries } from '@/types/api';
import { useMediaQuery } from '@/hooks/use-media-query';

interface LineChartStatsProps {
  data: MonthlyStatsSeries[];
  metric: 'quantity' | 'amount';
  /** 이중 Y축 모드: 수량(좌)과 금액(우)을 동시에 표시 */
  dualAxis?: boolean;
}

export function LineChartStats({ data, metric, dualAxis = false }: LineChartStatsProps) {
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

  // 데이터 변환: period (YYYY-MM) -> 월 표시 (연도 경계 시 또는 1월, 마지막 항목에 연도 포함)
  const chartData = data.map((item, index) => {
    const [year, month] = item.period.split('-');
    const prevYear = index > 0 ? data[index - 1].period.split('-')[0] : year;
    const isLastItem = index === data.length - 1;

    // 첫 번째 항목이거나, 이전 달과 연도가 다르거나, 1월이거나, 마지막 항목이면 연도 포함
    const shouldShowYear = index === 0 || year !== prevYear || month === '01' || isLastItem;
    const monthLabel = shouldShowYear ? `${year.substring(2)}.${month}` : month;

    return {
      ...item,
      month: monthLabel,
      fullDate: item.period,
    };
  });

  return (
    <Card className="p-4 sm:p-6">
      <div className="mb-3 sm:mb-4">
        <h3 className="text-base sm:text-lg font-semibold text-gray-900">
          월별 주문 추세 {dualAxis ? '(수량 + 금액)' : isQuantity ? '(수량)' : '(금액)'}
        </h3>
        <p className="text-xs sm:text-sm text-gray-500">
          5kg, 10kg 상품별 {dualAxis ? '수량과 매출 금액 비교' : isQuantity ? '주문 수량' : '매출 금액'}
        </p>
      </div>
      <div className="h-64 sm:h-80">
        {mounted ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              margin={isMobile
                ? { top: 5, right: dualAxis ? 35 : 10, left: 0, bottom: 5 }
                : { top: 5, right: dualAxis ? 80 : 30, left: 20, bottom: 5 }
              }
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="month"
                tick={{ fontSize: isMobile ? 10 : 12 }}
                label={isMobile ? undefined : { value: '월', position: 'insideBottomRight', offset: -10 }}
              />
              {/* 단일 축 모드 또는 이중 축 좌측 (수량) */}
              <YAxis
                yAxisId={dualAxis ? 'quantity' : 'left'}
                orientation="left"
                tick={{ fontSize: isMobile ? 10 : 12 }}
                width={isMobile ? 35 : 60}
                label={isMobile ? undefined : {
                  value: dualAxis || isQuantity ? '수량 (박스)' : '금액 (만원)',
                  angle: -90,
                  position: 'insideLeft',
                }}
                tickFormatter={(value) => {
                  if (dualAxis || isQuantity) {
                    return value.toString();
                  }
                  return (value / 10000).toFixed(0);
                }}
              />
              {/* 이중 축 우측 (금액) */}
              {dualAxis && (
                <YAxis
                  yAxisId="amount"
                  orientation="right"
                  tick={{ fontSize: isMobile ? 10 : 12 }}
                  width={isMobile ? 35 : 60}
                  label={isMobile ? undefined : {
                    value: '금액 (만원)',
                    angle: 90,
                    position: 'insideRight',
                  }}
                  tickFormatter={(value) => (value / 10000).toFixed(0)}
                />
              )}
              <Tooltip
                formatter={(value, name, props) => {
                  const v = value ?? 0;
                  const n = String(name ?? '');
                  const dataKey = String(props?.dataKey ?? '');
                  // 이중 축 모드에서는 dataKey로 금액/수량 구분 (i18n 안전)
                  if (dualAxis) {
                    const isAmountLine = dataKey.includes('Amount');
                    const formattedValue = isAmountLine ? `${Number(v).toLocaleString()}원` : `${v}박스`;
                    return [formattedValue, n];
                  }
                  const formattedValue = isQuantity ? `${v}박스` : `${Number(v).toLocaleString()}원`;
                  const label = dataKey.includes('5kg') ? '5kg' : '10kg';
                  return [formattedValue, label];
                }}
                labelFormatter={(label, payload) => {
                  if (payload && payload.length > 0 && payload[0].payload) {
                    const fullDate = payload[0].payload.fullDate as string;
                    return fullDate;
                  }
                  return label;
                }}
              />
              <Legend wrapperStyle={{ fontSize: isMobile ? 12 : 14 }} />
              {/* 이중 축 모드: 4개 라인 (수량 2 + 금액 2) */}
              {dualAxis ? (
                <>
                  <Line
                    yAxisId="quantity"
                    type="monotone"
                    dataKey="total5kgQty"
                    stroke="#f97316"
                    strokeWidth={2}
                    name="5kg 수량"
                    dot={isMobile ? false : { fill: '#f97316' }}
                  />
                  <Line
                    yAxisId="quantity"
                    type="monotone"
                    dataKey="total10kgQty"
                    stroke="#22c55e"
                    strokeWidth={2}
                    name="10kg 수량"
                    dot={isMobile ? false : { fill: '#22c55e' }}
                  />
                  <Line
                    yAxisId="amount"
                    type="monotone"
                    dataKey="total5kgAmount"
                    stroke="#fb923c"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    name="5kg 금액"
                    dot={isMobile ? false : { fill: '#fb923c' }}
                  />
                  <Line
                    yAxisId="amount"
                    type="monotone"
                    dataKey="total10kgAmount"
                    stroke="#4ade80"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    name="10kg 금액"
                    dot={isMobile ? false : { fill: '#4ade80' }}
                  />
                </>
              ) : (
                <>
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey={isQuantity ? 'total5kgQty' : 'total5kgAmount'}
                    stroke="#f97316"
                    strokeWidth={2}
                    name="5kg"
                    dot={isMobile ? false : { fill: '#f97316' }}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey={isQuantity ? 'total10kgQty' : 'total10kgAmount'}
                    stroke="#22c55e"
                    strokeWidth={2}
                    name="10kg"
                    dot={isMobile ? false : { fill: '#22c55e' }}
                  />
                </>
              )}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-muted-foreground">차트 로딩 중...</div>
          </div>
        )}
      </div>
    </Card>
  );
}
