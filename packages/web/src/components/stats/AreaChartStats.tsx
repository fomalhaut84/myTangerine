'use client';

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
  const isQuantity = metric === 'quantity';

  // Transform data to calculate cumulative values
  const chartData = data.reduce((acc, item, index) => {
    const current5kg = isQuantity ? item.total5kgQty : item.total5kgAmount;
    const current10kg = isQuantity ? item.total10kgQty : item.total10kgAmount;
    const currentTotal = current5kg + current10kg;
    const prevCumulative = index > 0 ? acc[index - 1].cumulative5kg + acc[index - 1].cumulative10kg : 0;

    // Add year markers for better context
    const [year, month] = item.period.split('-');
    const prevYear = index > 0 ? data[index - 1].period.split('-')[0] : year;
    const monthLabel = year !== prevYear || index === 0 ? `${year.substring(2)}.${month}` : month;

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
    <ResponsiveContainer width="100%" height={350}>
      <AreaChart data={chartData}>
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
          tick={{ fontSize: 12 }}
        />
        <YAxis
          className="text-xs"
          tick={{ fontSize: 12 }}
          tickFormatter={(value) => {
            if (isQuantity) {
              return value.toLocaleString();
            }
            return `${(value / 1000).toFixed(0)}K`;
          }}
        />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload || payload.length === 0) return null;

            const data = payload[0].payload;
            const unit = isQuantity ? '박스' : '원';
            const label = isQuantity ? '수량' : '매출';

            return (
              <div className="bg-background border rounded-lg shadow-lg p-3">
                <p className="font-semibold text-sm mb-2">{data.fullDate}</p>
                <div className="space-y-1 text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-orange-500" />
                    <span>5kg 누적: {data.cumulative5kg.toLocaleString()}{unit}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-green-500" />
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
          wrapperStyle={{ fontSize: '14px' }}
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
  );
}
