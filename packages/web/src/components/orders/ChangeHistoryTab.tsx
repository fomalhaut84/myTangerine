/**
 * 주문 변경 이력 탭 컴포넌트 (Phase 2)
 */

'use client';

import { useOrderHistory } from '@/hooks/use-order-history';
import type { ChangeLogEntry } from '@/lib/api-client';

interface ChangeHistoryTabProps {
  rowNumber: number;
}

/**
 * changedBy 아이콘 및 라벨
 */
const changedByInfo: Record<string, { icon: string; label: string; color: string }> = {
  web: { icon: '👤', label: '웹', color: 'text-blue-600' },
  sync: { icon: '🔄', label: '동기화', color: 'text-gray-600' },
  api: { icon: '🔌', label: 'API', color: 'text-purple-600' },
};

/**
 * action 라벨
 */
const actionLabels: Record<string, { label: string; color: string }> = {
  update: { label: '수정', color: 'bg-blue-100 text-blue-700' },
  status_change: { label: '상태 변경', color: 'bg-green-100 text-green-700' },
  delete: { label: '삭제', color: 'bg-red-100 text-red-700' },
  restore: { label: '복원', color: 'bg-yellow-100 text-yellow-700' },
  conflict_detected: { label: '충돌 감지', color: 'bg-orange-100 text-orange-700' },
};

/**
 * 필드명 한글화 (6차 리뷰: recipientAddress, productType 추가)
 */
const fieldLabels: Record<string, string> = {
  recipientName: '수취인 이름',
  recipientPhone: '수취인 전화번호',
  recipientAddress: '수취인 주소',
  postalCode: '우편번호',
  address: '주소',
  deliveryMemo: '배송 메모',
  quantity5kg: '5kg 수량',
  quantity10kg: '10kg 수량',
  productType: '상품 타입',
  // #282 상품 · 수량 수정
  productSelection: '상품 선택',
  quantity: '수량',
  validationError: '상품 선택 오류',
  price: '가격',
  status: '상태',
  deletedAt: '삭제 일시',
  senderName: '발송인 이름',
  senderPhone: '발송인 전화번호',
  senderAddress: '발송인 주소',
  orderType: '주문 유형',
  trackingNumber: '송장번호',
};

/**
 * 필드 변경 내용을 표시 가능한 문자열로 변환
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '(없음)';
  if (typeof value === 'string') return value || '(빈 값)';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '예' : '아니오';
  return JSON.stringify(value);
}

/**
 * 날짜 포맷팅
 */
function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 변경 이력 항목 컴포넌트
 */
function HistoryItem({ log }: { log: ChangeLogEntry }) {
  const changedBy = changedByInfo[log.changedBy] || changedByInfo.api;
  const action = actionLabels[log.action] || { label: log.action, color: 'bg-gray-100 text-gray-700' };
  const fieldChanges = log.fieldChanges || {};
  const changedFields = Object.keys(fieldChanges);

  return (
    <div className="relative pl-6 pb-6 border-l-2 border-gray-200 last:border-l-0 last:pb-0">
      {/* 타임라인 점 */}
      <div className="absolute left-[-9px] top-0 w-4 h-4 rounded-full bg-white border-2 border-gray-300 flex items-center justify-center">
        <div className="w-2 h-2 rounded-full bg-gray-400" />
      </div>

      {/* 헤더 */}
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-lg ${changedBy.color}`} title={changedBy.label}>
          {changedBy.icon}
        </span>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${action.color}`}>
          {action.label}
        </span>
        <span className="text-xs text-gray-500">
          v{log.previousVersion} → v{log.newVersion}
        </span>
        {log.conflictDetected && (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
            충돌
          </span>
        )}
        {log.conflictResolution && (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
            해결됨: {log.conflictResolution === 'db_wins' ? 'DB 우선' : log.conflictResolution === 'sheet_wins' ? '시트 우선' : '수동'}
          </span>
        )}
      </div>

      {/* 시간 */}
      <div className="text-xs text-gray-400 mb-2">
        {formatDateTime(log.changedAt)}
      </div>

      {/* 변경 내용 */}
      {changedFields.length > 0 && (
        <div className="bg-gray-50 rounded-lg p-3 space-y-2">
          {changedFields.map((field) => {
            const change = fieldChanges[field];
            const fieldLabel = fieldLabels[field] || field;
            return (
              <div key={field} className="flex items-start gap-2 text-sm">
                <span className="font-medium text-gray-600 min-w-[100px]">
                  {fieldLabel}:
                </span>
                <span className="text-red-500 line-through">
                  {formatValue(change.old)}
                </span>
                <span className="text-gray-400">→</span>
                <span className="text-green-600">
                  {formatValue(change.new)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * 변경 이력 탭 메인 컴포넌트
 */
export function ChangeHistoryTab({ rowNumber }: ChangeHistoryTabProps) {
  const { data, isLoading, error } = useOrderHistory(rowNumber, { limit: 50 });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8 text-red-500">
        변경 이력을 불러오는 중 오류가 발생했습니다.
      </div>
    );
  }

  const history = data?.history || [];

  if (history.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        변경 이력이 없습니다.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-800">변경 이력</h3>
      <div className="relative">
        {history.map((log) => (
          <HistoryItem key={log.id} log={log} />
        ))}
      </div>
    </div>
  );
}
