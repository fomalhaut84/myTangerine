/**
 * 주문 식별자 타입 결정 (#199)
 *
 * 프론트엔드는 응답의 idType 을 보고 상태 변경 요청을 rowNumber 또는 dbId 로 보낸다.
 * - dbId: 시트 행이 없는 DB 전용 주문 — 배송사고(claim) 주문(#155)
 * - rowNumber: 그 밖의 모든 주문 — 시트에 직접 입력된 배송사고 행 포함
 *
 * 시트 행이 있는 주문을 dbId 로 처리하면 DB 만 바뀌고 시트는 그대로라서, 배송완료 API 는
 * idType=dbId 를 시트 행이 없는 claim 에만 허용한다. 이 판정은 그 가드와 짝을 이룬다.
 */

export type OrderIdType = 'rowNumber' | 'dbId';

export interface OrderIdentity {
  orderType?: string;
  dbId?: number | null;
  /** 시트 행 번호 — 시트 행이 없으면 0 (sheetRowToOrder 규약) */
  rowNumber?: number | null;
}

export function hasSheetRow(order: OrderIdentity): boolean {
  return typeof order.rowNumber === 'number' && Number.isInteger(order.rowNumber) && order.rowNumber > 0;
}

export function resolveOrderIdType(order: OrderIdentity): OrderIdType {
  const isClaim = order.orderType === 'claim';
  const hasDbId = order.dbId !== undefined && order.dbId !== null;
  return isClaim && hasDbId && !hasSheetRow(order) ? 'dbId' : 'rowNumber';
}
