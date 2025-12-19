import groupBy from 'lodash/groupBy.js';
import type { Config } from '../config/config.js';
import type { Order, Sender } from '../types/order.js';

/**
 * 배송 라벨 포맷터
 * Python 버전의 LabelFormatter와 동일한 기능 제공
 */
export class LabelFormatter {
  private config: Config;
  private totalNonProduct: number = 0;
  private total5kg: number = 0;
  private total10kg: number = 0;
  private totalNonProductAmount: number = 0;
  private total5kgAmount: number = 0;
  private total10kgAmount: number = 0;

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
    this.totalNonProduct = 0;
    this.total5kg = 0;
    this.total10kg = 0;
    this.totalNonProductAmount = 0;
    this.total5kgAmount = 0;
    this.total10kgAmount = 0;

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
   * - 주문자 정보를 먼저 표시 (연락처 포함)
   * - 보내는분은 주문자와 다른 경우에만 표시
   */
  private formatSenderGroup(sender: Sender, orders: Order[]): string[] {
    const labels: string[] = [];

    // 첫 번째 주문의 주문자 정보 가져오기
    const firstOrder = orders[0];
    const ordererName = firstOrder.ordererName || sender.name;
    const ordererEmail = firstOrder.ordererEmail;

    // 발송인 정보 유효성 검사
    const validSender = LabelFormatter.isValidSender(sender.name, sender.address, sender.phone)
      ? sender
      : this.config.defaultSender;

    // 주문자 정보 표시 (이메일 주소 포함)
    labels.push('주문자\n');
    labels.push(`${ordererName}${ordererEmail ? ` (${ordererEmail})` : ''}\n`);

    // 보내는분이 주문자와 다른 경우에만 표시
    if (ordererName !== validSender.name) {
      labels.push(`보내는분: ${validSender.address} ${validSender.name} ${validSender.phone}\n`);
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

    const { recipient, productType, quantity, validationError, timestamp, trackingNumber } = order;
    labels.push(`${recipient.address} ${recipient.name} ${recipient.phone}\n`);

    // 송장번호가 있으면 표시
    if (trackingNumber) {
      labels.push(`송장번호: ${trackingNumber}\n`);
    }

    labels.push('주문상품\n');

    // 검증 에러가 있는 경우 에러 메시지 출력
    if (validationError) {
      labels.push(`[오류] ${validationError}\n\n`);
    } else if (productType === '비상품') {
      // 비상품 집계 (가격이 없어도 수량은 집계)
      this.totalNonProduct += quantity;

      const orderYear = timestamp.getFullYear();
      const prices = this.config.getPricesForYear(orderYear);
      const price = prices['비상품'];
      if (price) {
        // 비상품 가격이 있는 년도인 경우 금액 집계
        this.totalNonProductAmount += price * quantity;
      }

      labels.push(`비상품 / ${quantity}박스\n\n`);
    } else if (productType === '5kg') {
      this.total5kg += quantity;
      // 주문 년도의 가격으로 금액 계산
      const orderYear = timestamp.getFullYear();
      const prices = this.config.getPricesForYear(orderYear);
      const price = prices['5kg'];
      if (price) {
        this.total5kgAmount += price * quantity;
      }
      labels.push(`5kg / ${quantity}박스\n\n`);
    } else if (productType === '10kg') {
      this.total10kg += quantity;
      // 주문 년도의 가격으로 금액 계산
      const orderYear = timestamp.getFullYear();
      const prices = this.config.getPricesForYear(orderYear);
      this.total10kgAmount += prices['10kg'] * quantity;
      labels.push(`10kg / ${quantity}박스\n\n`);
    }

    return labels;
  }

  /**
   * 주문 요약 포맷팅 (금액 제외, 수량만 표시)
   */
  private formatSummary(): string[] {
    const totalBoxes = this.totalNonProduct + this.total5kg + this.total10kg;
    const summary: string[] = [
      '='.repeat(50) + '\n',
      '주문 요약\n',
      '-'.repeat(20) + '\n',
    ];

    // 비상품이 있는 경우에만 출력
    if (this.totalNonProduct > 0) {
      summary.push(`비상품 주문: ${this.totalNonProduct}박스\n`);
    }

    summary.push(
      `5kg 주문: ${this.total5kg}박스\n`,
      `10kg 주문: ${this.total10kg}박스\n`,
      '-'.repeat(20) + '\n',
      `총 주문: ${totalBoxes}박스\n`,
    );

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
