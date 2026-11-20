import groupBy from 'lodash/groupBy.js';
import type { Config } from '../config/config.js';
import type { Order, Sender } from '../types/order.js';
import { PRODUCT_CATALOG, findProduct, type ProductCatalog } from '../catalog/products.js';

/**
 * 배송 라벨 포맷터
 * Python 버전의 LabelFormatter와 동일한 기능 제공
 */
export class LabelFormatter {
  private config: Config;
  private readonly catalog: ProductCatalog;
  /** 상품별 박스 수 — formatLabels 호출마다 새로 만든다 (#313: 상품별 고정 필드 → 카탈로그) */
  private boxesByProduct: Map<string, number> = new Map();

  constructor(config: Config, catalog: ProductCatalog = PRODUCT_CATALOG) {
    this.config = config;
    this.catalog = catalog;
  }

  /**
   * 주문 목록을 포맷팅된 라벨 문자열로 변환
   * Python 버전의 format_labels() 메서드와 동일
   */
  formatLabels(orders: Order[]): string {
    if (orders.length === 0) {
      return '새로운 주문이 없습니다.';
    }

    // 주문 처리 전 합계 초기화
    this.boxesByProduct = new Map();

    const formattedLabels: string[] = [];

    // 타임스탬프 기준으로 정렬
    const sortedOrders = [...orders].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // 날짜별로 그룹화 (YYYY-MM-DD 형식)
    const dateGrouped = groupBy(sortedOrders, (order) => {
      const date = order.timestamp;
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    });

    // 날짜별로 라벨 생성
    for (const [date, dateOrders] of Object.entries(dateGrouped)) {
      formattedLabels.push(`=== ${date} ===\n`);

      // 보내는 사람별로 그룹화
      const senderGrouped = this.groupBySender(dateOrders);

      // 보내는 사람별 처리
      let firstSender = true;
      for (const [, senderOrders] of Object.entries(senderGrouped)) {
        if (!firstSender) {
          formattedLabels.push('\n');
        }

        const sender = senderOrders[0].sender; // 첫 번째 주문의 발송인 정보
        formattedLabels.push(...this.formatSenderGroup(sender, senderOrders));
        firstSender = false;
      }

      formattedLabels.push('=' .repeat(39) + '\n\n');
    }

    // 주문 요약 추가
    formattedLabels.push(...this.formatSummary());

    return formattedLabels.join('');
  }

  /**
   * 발송인별로 그룹화
   * 이름, 주소, 전화번호를 키로 사용
   */
  private groupBySender(orders: Order[]): Record<string, Order[]> {
    return groupBy(orders, (order) => {
      const { name, address, phone } = order.sender;
      return `${name}|${address}|${phone}`;
    });
  }

  /**
   * 발송인 그룹 포맷팅
   * - 보내는분 정보를 항상 표시 (이름, 전화번호, 주소)
   */
  private formatSenderGroup(sender: Sender, orders: Order[]): string[] {
    const labels: string[] = [];

    // 빈 그룹 방어 (groupBySender에서 생성된 그룹은 비어있을 수 없지만 안전을 위해)
    if (orders.length === 0) {
      return labels;
    }

    // 발송인 정보 유효성 검사
    const validSender = LabelFormatter.isValidSender(sender.name, sender.address, sender.phone)
      ? sender
      : this.config.defaultSender;

    // 보내는분 정보 표시 (항상 표시, 빈 값 방어 - 공백 문자열 포함)
    const senderName = validSender.name?.trim() || '(이름 없음)';
    const phoneInfo = validSender.phone?.trim() ? ` (${validSender.phone.trim()})` : '';
    const addressInfo = validSender.address?.trim() ? `주소: ${validSender.address.trim()}\n` : '';
    labels.push('보내는분\n');
    labels.push(`${senderName}${phoneInfo}\n`);
    if (addressInfo) {
      labels.push(addressInfo);
    }
    labels.push('\n');

    // 각 주문에 대한 수취인 정보 추가
    for (const order of orders) {
      labels.push(...this.formatRecipient(order));
    }

    return labels;
  }

  /**
   * 수취인 정보 포맷팅
   */
  private formatRecipient(order: Order): string[] {
    const labels: string[] = ['받는사람\n'];

    const { recipient, productType, quantity, validationError, trackingNumber } = order;
    labels.push(`${recipient.address} ${recipient.name} ${recipient.phone}\n`);

    // 송장번호가 있으면 표시
    if (trackingNumber) {
      labels.push(`송장번호: ${trackingNumber}\n`);
    }

    labels.push('주문상품\n');

    // 검증 에러가 있는 경우 에러 메시지 출력
    // 카탈로그에 없는 상품은 (검증 오류가 아니어도) 줄 · 합계 모두 빠진다 — 예전 동작 그대로
    // (금액은 라벨에 나오지 않아 집계하지 않는다 — 통계 금액은 api calculateOrderAmount)
    const product = findProduct(productType, this.catalog);
    if (validationError) {
      labels.push(`[오류] ${validationError}\n\n`);
    } else if (product) {
      this.boxesByProduct.set(product.id, (this.boxesByProduct.get(product.id) ?? 0) + quantity);
      labels.push(`${product.id} / ${quantity}박스\n\n`);
    }

    return labels;
  }

  /**
   * 주문 요약 포맷팅 (금액 제외, 수량만 표시)
   */
  private formatSummary(): string[] {
    const summary: string[] = [
      '='.repeat(50) + '\n',
      '주문 요약\n',
      '-'.repeat(20) + '\n',
    ];

    // 카탈로그 순서 — alwaysInSummary 가 아니면 있을 때만 (예: 비상품)
    let totalBoxes = 0;
    for (const product of this.catalog) {
      const boxes = this.boxesByProduct.get(product.id) ?? 0;
      totalBoxes += boxes;
      if (product.alwaysInSummary || boxes > 0) {
        summary.push(`${product.id} 주문: ${boxes}박스\n`);
      }
    }

    summary.push('-'.repeat(20) + '\n', `총 주문: ${totalBoxes}박스\n`);

    return summary;
  }

  /**
   * 발송인 정보 유효성 검사
   * 모든 필드가 비어있지 않은지 확인
   */
  private static isValidSender(name: string, address: string, phone: string): boolean {
    return (
      name != null &&
      name.trim() !== '' &&
      address != null &&
      address.trim() !== '' &&
      phone != null &&
      phone.trim() !== ''
    );
  }
}
