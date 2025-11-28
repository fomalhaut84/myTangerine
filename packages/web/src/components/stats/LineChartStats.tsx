/**
 * 월별 주문 추세 Line Chart
 */

'use client';

import { Card } from '@/components/common/Card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { MonthlyStatsSeries } from '@/types/api';

interface LineChartStatsProps {
  data: MonthlyStatsSeries[];
  metric: 'quantity' | 'amount';
}

export function LineChartStats({ data, metric }: LineChartStatsProps) {
  const isQuantity = metric === 'quantity';

  // 데이터 변환: period (YYYY-MM) -> 월 표시
  const chartData = data.map((item) => ({
    ...item,
    month: item.period.substring(5), // MM만 추출
    fullDate: item.period,
  }));

  return (
    <Card className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900">
          월별 주문 추세 {isQuantity ? '(수량)' : '(금액)'}
        </h3>
        <p className="text-sm text-gray-500">5kg, 10kg 상품별 {isQuantity ? '주문 수량' : '매출 금액'}</p>
      </div>
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="month"
              label={{ value: '월', position: 'insideBottomRight', offset: -10 }}
            />
            <YAxis
              label={{
                value: isQuantity ? '수량 (박스)' : '금액 (원)',
                angle: -90,
                position: 'insideLeft',
              }}
              tickFormatter={(value) => {
                if (isQuantity) {
                  return value.toString();
                }
                return (value / 10000).toFixed(0) + '만';
              }}
            />
            <Tooltip
              formatter={(value: number, name: string) => {
                const formattedValue = isQuantity ? value : `${value.toLocaleString()}원`;
                const label = name.includes('5kg') ? '5kg' : '10kg';
                return [formattedValue, label];
              }}
              labelFormatter={(label) => `${label}월`}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey={isQuantity ? 'total5kgQty' : 'total5kgAmount'}
              stroke="#f97316"
              strokeWidth={2}
              name="5kg"
              dot={{ fill: '#f97316' }}
            />
            <Line
              type="monotone"
              dataKey={isQuantity ? 'total10kgQty' : 'total10kgAmount'}
              stroke="#22c55e"
              strokeWidth={2}
              name="10kg"
              dot={{ fill: '#22c55e' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
