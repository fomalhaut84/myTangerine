/**
 * KPI 카드 컴포넌트
 * Issue #134: 반응형 폰트 사이즈 및 금액 축약 표기 적용
 */

'use client';

import { Card } from '@/components/common/Card';
import { formatCompactNumber } from '@/lib/utils';

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
  /** 금액 축약 사용 여부 (기본: 자동 - 원 단위일 때만) */
  compact?: boolean;
}

const variantClasses = {
  default: 'bg-gray-50 text-gray-900',
  primary: 'bg-blue-50 text-blue-900',
  success: 'bg-green-50 text-green-900',
  warning: 'bg-orange-50 text-orange-900',
};

export function KPICard({ title, value, unit, subtitle, trend, variant = 'default', compact }: KPICardProps) {
  // 금액(원) 단위일 때 자동으로 축약 표기 적용
  const shouldCompact = compact ?? (unit === '원' && typeof value === 'number');

  const displayValue = typeof value === 'number'
    ? shouldCompact
      ? formatCompactNumber(value)
      : value.toLocaleString()
    : value;

  return (
    <Card className={`p-3 sm:p-4 lg:p-5 ${variantClasses[variant]}`}>
      <div className="space-y-0.5 sm:space-y-1">
        <h3 className="text-xs sm:text-sm font-medium text-gray-600 whitespace-nowrap">{title}</h3>
        <div className="flex items-baseline gap-0.5 sm:gap-1 flex-wrap">
          <p className="text-lg sm:text-xl lg:text-2xl font-bold whitespace-nowrap">{displayValue}</p>
          {unit && <span className="text-xs sm:text-sm lg:text-base text-gray-600">{unit}</span>}
        </div>
        {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
        {trend && (
          <div className="flex items-center gap-1 flex-wrap">
            <span
              className={`text-xs sm:text-sm font-medium ${
                trend.value > 0 ? 'text-green-600' : trend.value < 0 ? 'text-red-600' : 'text-gray-600'
              }`}
            >
              {trend.value > 0 && '+'}
              {trend.value.toFixed(1)}%
            </span>
            <span className="text-xs sm:text-sm text-gray-500">{trend.label}</span>
          </div>
        )}
      </div>
    </Card>
  );
}
