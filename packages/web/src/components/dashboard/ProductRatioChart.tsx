/**
 * 상품 비율 차트 컴포넌트 (도넛 차트)
 */

'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { useOrdersSummary } from '@/hooks/use-orders';
import { Card } from '@/components/common/Card';
import { ChartSkeleton } from '@/components/common/DashboardSkeleton';

const COLORS = {
  '5kg': '#f97316', // orange-500
  '10kg': '#22c55e', // green-500
};

export function ProductRatioChart() {
  const { data, isLoading, error } = useOrdersSummary();

  if (isLoading) {
    return <ChartSkeleton title="상품 비율" />;
  }

  if (error) {
    return (
      <Card title="상품 비율">
        <div className="h-80 flex items-center justify-center">
          <div className="text-red-600">
            데이터를 불러오는 중 오류가 발생했습니다.
          </div>
        </div>
      </Card>
    );
  }

  if (!data?.summary) {
    return (
      <Card title="상품 비율">
        <div className="h-80 flex items-center justify-center">
          <div className="text-gray-500 dark:text-gray-400">
            데이터가 없습니다.
          </div>
        </div>
      </Card>
    );
  }

  const chartData = [
    {
      name: '5kg',
      value: data.summary['5kg'].count,
      amount: data.summary['5kg'].amount,
    },
    {
      name: '10kg',
      value: data.summary['10kg'].count,
      amount: data.summary['10kg'].amount,
    },
  ].filter((item) => item.value > 0);

  if (chartData.length === 0) {
    return (
      <Card title="상품 비율">
        <div className="h-80 flex items-center justify-center">
          <div className="text-gray-500 dark:text-gray-400">
            주문 데이터가 없습니다.
          </div>
        </div>
      </Card>
    );
  }

  const renderCustomLabel = ({
    cx,
    cy,
    midAngle,
    innerRadius,
    outerRadius,
    percent,
  }: {
    cx?: number;
    cy?: number;
    midAngle?: number;
    innerRadius?: number;
    outerRadius?: number;
    percent?: number;
  }) => {
    // 필수 값이 없으면 렌더링하지 않음
    if (
      cx === undefined ||
      cy === undefined ||
      midAngle === undefined ||
      innerRadius === undefined ||
      outerRadius === undefined ||
      percent === undefined
    ) {
      return null;
    }

    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    return (
      <text
        x={x}
        y={y}
        fill="white"
        textAnchor={x > cx ? 'start' : 'end'}
        dominantBaseline="central"
        className="text-sm font-semibold"
      >
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  return (
    <Card title="상품 비율">
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={renderCustomLabel}
              outerRadius={100}
              innerRadius={60}
              fill="#8884d8"
              dataKey="value"
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[entry.name as keyof typeof COLORS]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
              }}
              formatter={(value: number, name: string, props: { payload?: { amount: number } }) => {
                const amount = props.payload?.amount ?? 0;
                return [
                  `${value}개 (${amount.toLocaleString()}원)`,
                  name,
                ];
              }}
            />
            <Legend
              wrapperStyle={{
                paddingTop: '20px',
              }}
              formatter={(value, entry) => {
                const item = entry.payload as unknown as { value: number; amount: number } | undefined;
                if (!item || typeof item.value !== 'number' || typeof item.amount !== 'number') {
                  return value;
                }
                return `${value}: ${item.value}개 (${item.amount.toLocaleString()}원)`;
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
