/**
 * PDF 데이터 변환 로직
 * Issue #98: 주문 목록 PDF 내보내기
 */

import type { Order } from '../types/order.js';
import type { PdfTableRow } from '../types/pdf.js';

/**
 * Order 객체를 PDF 테이블 행으로 변환
 *
 * @param order - 주문 데이터
 * @param index - 행 번호 (0-based)
 * @returns PDF 테이블 행 데이터
 */
export function mapOrderToPdfRow(order: Order, index: number): PdfTableRow {
  // 수량 계산 (5kg + 10kg)
  const quantity = (order.quantity5kg || 0) + (order.quantity10kg || 0);

  // 품목명 결정
  let productType = '-';
  if (order.quantity5kg > 0 && order.quantity10kg > 0) {
    productType = '5kg/10kg';
  } else if (order.quantity5kg > 0) {
    productType = '5kg';
  } else if (order.quantity10kg > 0) {
    productType = '10kg';
  } else if (order.productType) {
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
 * 여러 주문을 PDF 테이블 행 배열로 변환
 *
 * @param orders - 주문 데이터 배열
 * @returns PDF 테이블 행 배열
 */
export function mapOrdersToPdfRows(orders: Order[]): PdfTableRow[] {
  return orders.map((order, index) => mapOrderToPdfRow(order, index));
}
