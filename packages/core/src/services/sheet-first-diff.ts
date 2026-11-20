/**
 * 시트 우선 가져오기(#281) 변경 이력 비교
 *
 * upsert update 가 덮어쓰는 필드 전체를 비교한다 — 상태 되돌림 · 송장 삭제 · 삭제 복원까지 이력에 남겨야
 * "DB 가 정본" 에서 복구를 추적할 수 있다.
 */

import type { FieldChange } from './change-log-service.js';

/** 시트 우선 가져오기가 덮어쓰고 이력에 남기는 필드 (`sheetRowToPrismaOrderData` 결과 기준) */
export const SHEET_FIRST_COMPARED_FIELDS = [
  'timestampRaw',
  'timestamp',
  'status',
  'trackingNumber',
  'deletedAt',
  'orderType',
  'productSelection',
  'productType',
  'quantity',
  'quantity5kg',
  'quantity10kg',
  'validationError',
  'ordererName',
  'ordererEmail',
  'senderName',
  'senderPhone',
  'senderAddress',
  'recipientName',
  'recipientPhone',
  'recipientAddress',
] as const;

/** 비교용 정규화 — 빈 문자열 = null, Date → ISO, 숫자 → 문자열 */
function normalize(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * @param next - 덮어쓸 값(`sheetRowToPrismaOrderData` 결과). 값이 undefined 인 필드는 덮어쓰지 않으므로 비교하지 않는다
 * @param current - 지금 DB 값
 */
export function diffSheetFirstOverwrite(
  next: Record<string, unknown>,
  current: Record<string, unknown>
): Record<string, FieldChange> {
  return Object.fromEntries(
    SHEET_FIRST_COMPARED_FIELDS.filter((field) => next[field] !== undefined)
      .map((field) => [field, normalize(current[field]), normalize(next[field])] as const)
      .filter(([, oldValue, newValue]) => oldValue !== newValue)
      .map(([field, oldValue, newValue]) => [field, { old: oldValue, new: newValue }])
  );
}
