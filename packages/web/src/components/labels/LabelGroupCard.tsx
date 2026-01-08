/**
 * 라벨 그룹 카드 컴포넌트 (날짜/발신자별)
 */

'use client';

import type { LabelGroup } from '@/types/api';
import { Card } from '@/components/common/Card';
import { useState } from 'react';

interface LabelGroupCardProps {
  group: LabelGroup;
  isSelected?: boolean;
  onSelect?: (selected: boolean) => void;
}

export function LabelGroupCard({ group, isSelected, onSelect }: LabelGroupCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <div className="space-y-4">
        {/* 헤더 */}
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3 flex-1">
            {onSelect && (
              <input
                type="checkbox"
                checked={isSelected}
                onChange={(e) => onSelect(e.target.checked)}
                className="mt-1 w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
              />
            )}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-xl font-bold text-gray-900">
                  {group.sender.name}
                </h3>
                <span className="text-sm px-2 py-1 bg-blue-100 text-blue-700 rounded-full">
                  {group.orders.length}건
                </span>
              </div>
              <p className="text-sm text-gray-600">
                {group.sender.phone}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {group.date}
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            {isExpanded ? '접기' : '상세보기'}
          </button>
        </div>

        {/* 요약 정보 */}
        <div className="grid grid-cols-3 gap-4 p-4 bg-gray-50 rounded-lg">
          {group.summary['5kg'].count > 0 && (
            <div>
              <p className="text-xs text-gray-500">5kg</p>
              <p className="text-lg font-semibold text-orange-600">
                {group.summary['5kg'].count}박스
              </p>
              <p className="text-xs text-gray-600">
                {group.summary['5kg'].amount.toLocaleString()}원
              </p>
            </div>
          )}
          {group.summary['10kg'].count > 0 && (
            <div>
              <p className="text-xs text-gray-500">10kg</p>
              <p className="text-lg font-semibold text-green-600">
                {group.summary['10kg'].count}박스
              </p>
              <p className="text-xs text-gray-600">
                {group.summary['10kg'].amount.toLocaleString()}원
              </p>
            </div>
          )}
          <div>
            <p className="text-xs text-gray-500">합계</p>
            <p className="text-lg font-bold text-blue-600">
              {group.summary.total.toLocaleString()}원
            </p>
          </div>
        </div>

        {/* 상세 주문 목록 */}
        {isExpanded && (
          <div className="space-y-2 pt-4 border-t border-gray-200">
            {group.orders.map((order) => (
              <div
                key={order.rowNumber}
                className="p-3 bg-white border border-gray-200 rounded-lg"
              >
                <div className="flex justify-between items-start gap-3">
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">
                      {order.recipient.name}
                    </p>
                    <p className="text-sm text-gray-600">
                      {order.recipient.address}
                    </p>
                    <p className="text-sm text-gray-500">
                      {order.recipient.phone}
                    </p>
                    {order.validationError && (
                      <p className="mt-2 text-sm text-red-600">
                        {order.validationError}
                      </p>
                    )}
                  </div>
                  {order.validationError ? (
                    <span className="px-3 py-1 rounded-full text-sm font-medium whitespace-nowrap bg-red-100 text-red-700">
                      오류
                    </span>
                  ) : order.productType ? (
                    <span
                      className={`px-3 py-1 rounded-full text-sm font-medium whitespace-nowrap ${
                        order.productType === '5kg'
                          ? 'bg-orange-100 text-orange-700'
                          : 'bg-green-100 text-green-700'
                      }`}
                    >
                      {order.productType} × {order.quantity}
                    </span>
                  ) : (
                    <span className="px-3 py-1 rounded-full text-sm font-medium whitespace-nowrap bg-gray-100 text-gray-700">
                      알 수 없음
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
