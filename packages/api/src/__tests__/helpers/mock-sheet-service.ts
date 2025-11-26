/**
 * 테스트용 SheetService mock
 */

import type { SheetRow } from '@mytangerine/core';

/**
 * Mock SheetService 클래스
 */
export class MockSheetService {
  private mockNewOrders: SheetRow[] = [];
  private confirmedCount = 0;

  /**
   * Mock 데이터 설정
   */
  setMockNewOrders(orders: SheetRow[]): void {
    this.mockNewOrders = orders;
  }

  /**
   * Status별 주문 조회 (mock)
   * @param status - 'new', 'completed', 'all'
   */
  async getOrdersByStatus(status: 'new' | 'completed' | 'all' = 'new'): Promise<SheetRow[]> {
    // Mock에서는 단순히 mockNewOrders를 반환
    // status에 따른 필터링은 실제 SheetService에서만 동작
    if (status === 'new' || status === 'all') {
      return this.mockNewOrders;
    }
    return []; // completed는 빈 배열
  }

  /**
   * 새로운 주문 조회 (mock) - 하위 호환성
   */
  async getNewOrders(): Promise<SheetRow[]> {
    return this.getOrdersByStatus('new');
  }

  /**
   * 주문 확인 처리 (mock)
   * @param rowNumbers - 확인 처리할 행 번호 배열 (선택). 미제공 시 모든 주문 확인
   */
  async markAsConfirmed(rowNumbers?: number[]): Promise<void> {
    if (rowNumbers) {
      // 명시적으로 전달된 행 번호만 확인
      this.confirmedCount = rowNumbers.length;
      // 해당 행들을 mockNewOrders에서 제거
      this.mockNewOrders = this.mockNewOrders.filter(
        (order) => !rowNumbers.includes(order._rowNumber || 0)
      );
    } else {
      // 하위 호환성: 모든 주문 확인
      this.confirmedCount = this.mockNewOrders.length;
      this.mockNewOrders = []; // 확인 후 비우기
    }
  }

  /**
   * 확인된 개수 조회 (테스트용)
   */
  getConfirmedCount(): number {
    return this.confirmedCount;
  }

  /**
   * Mock 초기화
   */
  reset(): void {
    this.mockNewOrders = [];
    this.confirmedCount = 0;
  }
}

/**
 * 테스트용 샘플 SheetRow 데이터 생성
 */
export function createMockSheetRow(overrides?: Partial<SheetRow>): SheetRow {
  return {
    '타임스탬프': '2025. 1. 21. 오전 10:30:00',
    '비고': '',
    '보내는분 성함': '홍길동',
    '보내는분 주소 (도로명 주소로 부탁드려요)': '서울시 강남구',
    '보내는분 연락처 (핸드폰번호)': '010-1234-5678',
    '받으실분 성함': '김철수',
    '받으실분 주소 (도로명 주소로 부탁드려요)': '서울시 송파구',
    '받으실분 연락처 (핸드폰번호)': '010-9876-5432',
    '상품 선택': '5kg',
    '5kg 수량': '2',
    '10kg 수량': '',
    _rowNumber: 10,
    ...overrides,
  };
}

/**
 * 여러 개의 mock SheetRow 생성
 */
export function createMockSheetRows(count: number): SheetRow[] {
  return Array.from({ length: count }, (_, i) => {
    const is5kg = i % 2 === 0;
    const quantity = String((i % 3) + 1);
    return createMockSheetRow({
      _rowNumber: i + 10,
      '받으실분 성함': `테스트${i + 1}`,
      '상품 선택': is5kg ? '5kg' : '10kg',
      '5kg 수량': is5kg ? quantity : '',
      '10kg 수량': is5kg ? '' : quantity,
    });
  });
}
