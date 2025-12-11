/**
 * 테스트용 DatabaseService mock
 * Issue #68 Phase 2.1
 */

import type { SheetRow } from '@mytangerine/core';

/**
 * Mock DatabaseService 클래스
 * SheetService와 동일한 인터페이스 제공
 */
export class MockDatabaseService {
  private mockNewOrders: SheetRow[] = [];
  private mockCompletedOrders: SheetRow[] = [];
  private mockAllOrders: SheetRow[] = [];
  private confirmedCount = 0;

  /**
   * Mock 데이터 설정 (신규 주문)
   */
  setMockNewOrders(orders: SheetRow[]): void {
    this.mockNewOrders = orders;
  }

  /**
   * Mock 데이터 설정 (완료된 주문)
   */
  setMockCompletedOrders(orders: SheetRow[]): void {
    this.mockCompletedOrders = orders;
  }

  /**
   * Mock 데이터 설정 (전체 주문)
   */
  setMockAllOrders(orders: SheetRow[]): void {
    this.mockAllOrders = orders;
  }

  /**
   * Status별 주문 조회 (mock)
   * @param status - 'new', 'completed', 'all'
   */
  async getOrdersByStatus(status: 'new' | 'completed' | 'all' = 'new'): Promise<SheetRow[]> {
    if (status === 'completed') {
      return this.mockCompletedOrders;
    } else if (status === 'all') {
      // mockAllOrders가 설정되어 있으면 그것을 사용, 아니면 new + completed 합산
      if (this.mockAllOrders.length > 0) {
        return this.mockAllOrders;
      }
      return [...this.mockNewOrders, ...this.mockCompletedOrders];
    } else {
      return this.mockNewOrders;
    }
  }

  /**
   * 새로운 주문 조회 (mock) - 하위 호환성
   */
  async getNewOrders(): Promise<SheetRow[]> {
    return this.getOrdersByStatus('new');
  }

  /**
   * 모든 행 조회 (mock)
   */
  async getAllRows(): Promise<SheetRow[]> {
    return this.getOrdersByStatus('all');
  }

  /**
   * 특정 행 번호로 주문 조회 (mock)
   * @param rowNumber 스프레드시트 행 번호
   * @returns 주문 데이터 또는 null
   */
  async getOrderByRowNumber(rowNumber: number): Promise<SheetRow | null> {
    // 모든 주문(new + completed + all)에서 검색
    const allOrders = [
      ...this.mockNewOrders,
      ...this.mockCompletedOrders,
      ...this.mockAllOrders,
    ];

    const order = allOrders.find((o) => o._rowNumber === rowNumber);
    return order || null;
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
   * 주문 생성 또는 업데이트 (mock)
   * 실제 DatabaseService의 upsertOrder와 동일한 시그니처
   */
  async upsertOrder(row: SheetRow): Promise<void> {
    const rowNumber = row._rowNumber || 0;

    // 기존 주문 찾기
    const allOrders = [
      ...this.mockNewOrders,
      ...this.mockCompletedOrders,
      ...this.mockAllOrders,
    ];

    const existingIndex = allOrders.findIndex((o) => o._rowNumber === rowNumber);

    if (existingIndex >= 0) {
      // 업데이트: 기존 데이터를 새 데이터로 교체
      if (row['비고'] === '확인') {
        // 완료된 주문으로 이동
        this.mockCompletedOrders.push(row);
        this.mockNewOrders = this.mockNewOrders.filter((o) => o._rowNumber !== rowNumber);
      } else {
        // 신규 주문 업데이트
        const idx = this.mockNewOrders.findIndex((o) => o._rowNumber === rowNumber);
        if (idx >= 0) {
          this.mockNewOrders[idx] = row;
        } else {
          this.mockNewOrders.push(row);
        }
      }
    } else {
      // 생성: 새 주문 추가
      if (row['비고'] === '확인') {
        this.mockCompletedOrders.push(row);
      } else {
        this.mockNewOrders.push(row);
      }
    }
  }

  /**
   * 연결 종료 (mock) - no-op
   */
  async disconnect(): Promise<void> {
    // no-op
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
    this.mockCompletedOrders = [];
    this.mockAllOrders = [];
    this.confirmedCount = 0;
  }
}
