/**
 * 품목별 비율 Donut Chart
 */

'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/common/Card';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import type { ProductTotals } from '@/types/api';

interface DonutChartStatsProps {
  data: ProductTotals[];
  metric: 'quantity' | 'amount';
}

const COLORS = {
  '비상품': '#94a3b8',
  '5kg': '#f97316',
  '10kg': '#22c55e',
};

export function DonutChartStats({ data, metric }: DonutChartStatsProps) {
  const [mounted, setMounted] = useState(false);
  const isQuantity = metric === 'quantity';

  useEffect(() => {
    // DOM이 완전히 준비된 후 차트 렌더링
    const timer = setTimeout(() => {
      setMounted(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // 데이터 변환
  const chartData = data.map((item) => ({
    name: item.productType,
    value: isQuantity ? item.quantity : item.amount,
    percentage: isQuantity ? item.quantityPct : item.revenuePct,
  }));

  return (
    <Card className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900">
          품목별 비율 {isQuantity ? '(수량)' : '(금액)'}
        </h3>
        <p className="text-sm text-gray-500">5kg vs 10kg {isQuantity ? '주문 수량' : '매출'} 비교</p>
      </div>
      <div className="h-80">
        {mounted ? (
          <ResponsiveContainer width="100%" height={320}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={5}
                dataKey="value"
                label={(entry) => {
                  const item = entry as unknown as { name: string; percentage: number };
                  return `${item.name}: ${item.percentage.toFixed(1)}%`;
                }}
              >
                {chartData.map((entry) => (
                  <Cell key={entry.name} fill={COLORS[entry.name as keyof typeof COLORS]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number, name: string) => {
                  const formattedValue = isQuantity ? `${value}박스` : `${value.toLocaleString()}원`;
                  return [formattedValue, name];
                }}
              />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-muted-foreground">차트 로딩 중...</div>
          </div>
        )}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4">
        {chartData.map((item) => (
          <div key={item.name} className="text-center">
            <p className="text-sm text-gray-600">{item.name}</p>
            <p className="text-lg font-semibold" style={{ color: COLORS[item.name as keyof typeof COLORS] }}>
              {isQuantity ? `${item.value}박스` : `${item.value.toLocaleString()}원`}
            </p>
            <p className="text-xs text-gray-500">{item.percentage.toFixed(1)}%</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
