/**
 * Excel 데이터 변환 로직
 * Issue #113: 주문 목록 Excel 내보내기
 */

import type { Order } from '../types/order.js';
import type { ExcelTableRow } from '../types/excel.js';

/**
 * Order 객체를 Excel 테이블 행으로 변환
 *
 * @param order - 주문 데이터
 * @param index - 행 번호 (0-based)
 * @returns Excel 테이블 행 데이터
 */
export function mapOrderToExcelRow(order: Order, index: number): ExcelTableRow {
  // 수량은 Order 객체에 이미 계산되어 있음
  const quantity = order.quantity;

  // 품목명 결정 (productType 또는 validationError 사용)
  let productType = '-';
  if (order.validationError) {
    // 검증 에러가 있으면 에러 메시지 표시
    productType = `[오류] ${order.validationError}`;
  } else if (order.productType) {
    // 정상적인 상품 타입
    productType = order.productType;
  }

  return {
    번호: index + 1,
    보내는분_성명: order.sender.name || '-',
    보내는분_전화번호: order.sender.phone || '-',
    받는분_주소: order.recipient.address || '-',
    받는분_성명: order.recipient.name || '-',
    받는분_전화번호: order.recipient.phone || '-',
    수량: quantity,
    품목명: productType,
  };
}

/**
 * 여러 주문을 Excel 테이블 행 배열로 변환
 *
 * @param orders - 주문 데이터 배열
 * @returns Excel 테이블 행 배열
 */
export function mapOrdersToExcelRows(orders: Order[]): ExcelTableRow[] {
  return orders.map((order, index) => mapOrderToExcelRow(order, index));
}
