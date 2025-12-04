/**
 * KPI 카드 컴포넌트
 */

'use client';

import { Card } from '@/components/common/Card';

interface KPICardProps {
  title: string;
  value: string | number;
  unit?: string;
  subtitle?: string;
  trend?: {
    value: number;
    label: string;
  };
  variant?: 'default' | 'primary' | 'success' | 'warning';
}

const variantClasses = {
  default: 'bg-gray-50 text-gray-900',
  primary: 'bg-blue-50 text-blue-900',
  success: 'bg-green-50 text-green-900',
  warning: 'bg-orange-50 text-orange-900',
};

export function KPICard({ title, value, unit, subtitle, trend, variant = 'default' }: KPICardProps) {
  return (
    <Card className={`p-6 ${variantClasses[variant]}`}>
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-gray-600">{title}</h3>
        <div className="flex items-baseline gap-2">
          <p className="text-3xl font-bold">{value.toLocaleString()}</p>
          {unit && <span className="text-lg text-gray-600">{unit}</span>}
        </div>
        {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
        {trend && (
          <div className="flex items-center gap-1">
            <span
              className={`text-sm font-medium ${
                trend.value > 0 ? 'text-green-600' : trend.value < 0 ? 'text-red-600' : 'text-gray-600'
              }`}
            >
              {trend.value > 0 && '+'}
              {trend.value.toFixed(1)}%
            </span>
            <span className="text-sm text-gray-500">{trend.label}</span>
          </div>
        )}
      </div>
    </Card>
  );
}
