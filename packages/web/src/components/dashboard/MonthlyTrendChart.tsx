/**
 * 월별 주문 추이 차트 컴포넌트
 */

'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useMonthlyStats } from '@/hooks/use-stats';
import { Card } from '@/components/common/Card';
import { ChartSkeleton } from '@/components/common/DashboardSkeleton';

export function MonthlyTrendChart() {
  const { data, isLoading, error } = useMonthlyStats();

  if (isLoading) {
    return <ChartSkeleton title="월별 주문 추이" />;
  }

  if (error) {
    return (
      <Card title="월별 주문 추이">
        <div className="h-80 flex items-center justify-center">
          <div className="text-red-600">
            데이터를 불러오는 중 오류가 발생했습니다.
          </div>
        </div>
      </Card>
    );
  }

  if (!data?.data || data.data.length === 0) {
    return (
      <Card title="월별 주문 추이">
        <div className="h-80 flex items-center justify-center">
          <div className="text-gray-500 dark:text-gray-400">
            데이터가 없습니다.
          </div>
        </div>
      </Card>
    );
  }

  // 데이터 변환 (월을 "MM월" 형식으로 표시)
  const chartData = data.data.map((item) => ({
    month: item.month.split('-')[1] + '월',
    '5kg': item.total5kg,
    '10kg': item.total10kg,
    주문수: item.count,
  }));

  return (
    <Card title="월별 주문 추이">
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{
              top: 5,
              right: 30,
              left: 20,
              bottom: 5,
            }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
            <XAxis
              dataKey="month"
              className="text-xs fill-gray-600 dark:fill-gray-400"
            />
            <YAxis className="text-xs fill-gray-600 dark:fill-gray-400" />
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
              }}
              labelStyle={{ color: '#374151' }}
            />
            <Legend
              wrapperStyle={{
                paddingTop: '20px',
              }}
            />
            <Line
              type="monotone"
              dataKey="5kg"
              stroke="#f97316"
              strokeWidth={2}
              activeDot={{ r: 6 }}
              name="5kg 수량"
            />
            <Line
              type="monotone"
              dataKey="10kg"
              stroke="#22c55e"
              strokeWidth={2}
              activeDot={{ r: 6 }}
              name="10kg 수량"
            />
            <Line
              type="monotone"
              dataKey="주문수"
              stroke="#3b82f6"
              strokeWidth={2}
              activeDot={{ r: 6 }}
              name="주문 개수"
              strokeDasharray="5 5"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
