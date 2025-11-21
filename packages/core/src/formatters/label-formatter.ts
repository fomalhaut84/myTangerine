import groupBy from 'lodash/groupBy.js';
import type { Config } from '../config/config.js';
import type { Order, Sender } from '../types/order.js';

/**
 * 배송 라벨 포맷터
 * Python 버전의 LabelFormatter와 동일한 기능 제공
 */
export class LabelFormatter {
  private config: Config;
  private total5kg: number = 0;
  private total10kg: number = 0;

  constructor(config: Config) {
    this.config = config;
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
    this.total5kg = 0;
    this.total10kg = 0;

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
      for (const [_senderKey, senderOrders] of Object.entries(senderGrouped)) {
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
   */
  private formatSenderGroup(sender: Sender, orders: Order[]): string[] {
    const labels: string[] = ['보내는사람\n'];

    // 발송인 정보 유효성 검사
    if (LabelFormatter.isValidSender(sender.name, sender.address, sender.phone)) {
      labels.push(`${sender.address} ${sender.name} ${sender.phone}\n\n`);
    } else {
      const defaultSender = this.config.defaultSender;
      labels.push(
        `${defaultSender.address} ${defaultSender.name} ${defaultSender.phone}\n\n`
      );
    }

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

    const { recipient, productType, quantity } = order;
    labels.push(`${recipient.address} ${recipient.name} ${recipient.phone}\n`);

    labels.push('주문상품\n');

    if (productType === '5kg') {
      this.total5kg += quantity;
      labels.push(`5kg / ${quantity}박스\n\n`);
    } else if (productType === '10kg') {
      this.total10kg += quantity;
      labels.push(`10kg / ${quantity}박스\n\n`);
    }

    return labels;
  }

  /**
   * 주문 요약 포맷팅
   */
  private formatSummary(): string[] {
    const price5kg = this.total5kg * this.config.productPrices['5kg'];
    const price10kg = this.total10kg * this.config.productPrices['10kg'];
    const totalPrice = price5kg + price10kg;

    return [
      '='.repeat(50) + '\n',
      '주문 요약\n',
      '-'.repeat(20) + '\n',
      `5kg 주문: ${this.total5kg}박스 (${price5kg.toLocaleString()}원)\n`,
      `10kg 주문: ${this.total10kg}박스 (${price10kg.toLocaleString()}원)\n`,
      '-'.repeat(20) + '\n',
      `총 주문금액: ${totalPrice.toLocaleString()}원\n`,
    ];
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
