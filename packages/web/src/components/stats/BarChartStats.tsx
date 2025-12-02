/**
 * 월별 매출 Bar Chart (스택)
 */

'use client';

import { Card } from '@/components/common/Card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { MonthlyStatsSeries } from '@/types/api';

interface BarChartStatsProps {
  data: MonthlyStatsSeries[];
  metric: 'quantity' | 'amount';
}

export function BarChartStats({ data, metric }: BarChartStatsProps) {
  const isQuantity = metric === 'quantity';

  // 데이터 변환: period (YYYY-MM) -> 월 표시 (연도 경계 시 연도 포함)
  const chartData = data.map((item, index) => {
    const [year, month] = item.period.split('-');
    const prevYear = index > 0 ? data[index - 1].period.split('-')[0] : year;

    // 이전 달과 연도가 다르면 연도 포함
    const monthLabel = year !== prevYear || index === 0 ? `${year.substring(2)}.${month}` : month;

    return {
      ...item,
      month: monthLabel,
      fullDate: item.period,
    };
  });

  return (
    <Card className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900">
          월별 매출 추이 {isQuantity ? '(수량)' : '(금액)'}
        </h3>
        <p className="text-sm text-gray-500">5kg, 10kg 누적 {isQuantity ? '수량' : '매출'}</p>
      </div>
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="month"
              label={{ value: '월', position: 'insideBottomRight', offset: -10 }}
            />
            <YAxis
              label={{
                value: isQuantity ? '수량 (박스)' : '금액 (만원)',
                angle: -90,
                position: 'insideLeft',
              }}
              tickFormatter={(value) => {
                if (isQuantity) {
                  return value.toString();
                }
                return (value / 10000).toFixed(0);
              }}
            />
            <Tooltip
              formatter={(value: number, name: string) => {
                const formattedValue = isQuantity ? `${value}박스` : `${value.toLocaleString()}원`;
                const label = name.includes('5kg') ? '5kg' : '10kg';
                return [formattedValue, label];
              }}
              labelFormatter={(label, payload) => {
                if (payload && payload.length > 0 && payload[0].payload) {
                  const fullDate = payload[0].payload.fullDate as string;
                  return fullDate; // YYYY-MM 형식으로 표시
                }
                return label;
              }}
            />
            <Legend />
            <Bar
              dataKey={isQuantity ? 'total5kgQty' : 'total5kgAmount'}
              stackId="a"
              fill="#f97316"
              name="5kg"
            />
            <Bar
              dataKey={isQuantity ? 'total10kgQty' : 'total10kgAmount'}
              stackId="a"
              fill="#22c55e"
              name="10kg"
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
