/**
 * 테스트용 DatabaseService mock
 * Issue #68 Phase 2.1
 */

import type { SheetRow } from '@mytangerine/core';
import type { Order as PrismaOrder } from '@prisma/client';

/**
 * Mock DatabaseService 클래스
 * SheetService와 동일한 인터페이스 제공
 */
export class MockDatabaseService {
  private mockNewOrders: SheetRow[] = [];
  private mockCompletedOrders: SheetRow[] = [];
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
   * Status별 주문 조회 (mock)
   * @param status - 'new', 'completed', 'all'
   */
  async getOrdersByStatus(status: 'new' | 'completed' | 'all' = 'new'): Promise<SheetRow[]> {
    if (status === 'completed') {
      return this.mockCompletedOrders;
    } else if (status === 'all') {
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
    const allOrders = [...this.mockNewOrders, ...this.mockCompletedOrders];
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

      // 해당 행들을 mockNewOrders에서 mockCompletedOrders로 이동
      const toConfirm = this.mockNewOrders.filter((order) =>
        rowNumbers.includes(order._rowNumber || 0)
      );

      toConfirm.forEach((order) => {
        order['비고'] = '확인';
        this.mockCompletedOrders.push(order);
      });

      this.mockNewOrders = this.mockNewOrders.filter(
        (order) => !rowNumbers.includes(order._rowNumber || 0)
      );
    } else {
      // 하위 호환성: 모든 주문 확인
      this.confirmedCount = this.mockNewOrders.length;

      // 모든 신규 주문을 완료로 이동
      this.mockNewOrders.forEach((order) => {
        order['비고'] = '확인';
        this.mockCompletedOrders.push(order);
      });

      this.mockNewOrders = []; // 확인 후 비우기
    }
  }

  /**
   * 단일 주문 확인 처리 (mock)
   * @param rowNumber - 확인 처리할 행 번호
   */
  async markSingleAsConfirmed(rowNumber: number): Promise<void> {
    return this.markAsConfirmed([rowNumber]);
  }

  /**
   * 특정 셀 업데이트 (mock)
   * @param rowNumber - 행 번호
   * @param columnName - 컬럼명
   * @param value - 업데이트할 값
   */
  async updateCell(rowNumber: number, columnName: string, value: string): Promise<void> {
    const allOrders = [...this.mockNewOrders, ...this.mockCompletedOrders];
    const order = allOrders.find((o) => o._rowNumber === rowNumber);

    if (order) {
      // 컬럼명 매핑
      if (columnName === '비고') {
        order['비고'] = value;
      }
      // 추가 매핑 필요 시 여기에 추가
    }
  }

  /**
   * 주문 생성 또는 업데이트 (mock)
   * 실제 DatabaseService의 upsertOrder와 동일한 시그니처
   */
  async upsertOrder(
    row: SheetRow,
    syncMeta?: {
      syncStatus: 'pending' | 'success' | 'failed';
      syncAttemptCount?: number;
      syncErrorMessage?: string;
    }
  ): Promise<Partial<PrismaOrder>> {
    const rowNumber = row._rowNumber || 0;

    // 기존 주문 찾기
    const allOrders = [...this.mockNewOrders, ...this.mockCompletedOrders];
    const existingIndex = allOrders.findIndex((o) => o._rowNumber === rowNumber);

    if (existingIndex >= 0) {
      // 업데이트: 기존 데이터를 새 데이터로 교체
      if (row['비고'] === '확인') {
        // 완료된 주문으로 이동
        const newIdx = this.mockNewOrders.findIndex((o) => o._rowNumber === rowNumber);
        if (newIdx >= 0) {
          this.mockNewOrders.splice(newIdx, 1);
        }
        const completedIdx = this.mockCompletedOrders.findIndex((o) => o._rowNumber === rowNumber);
        if (completedIdx >= 0) {
          this.mockCompletedOrders[completedIdx] = row;
        } else {
          this.mockCompletedOrders.push(row);
        }
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

    // PrismaOrder 형태로 반환 (최소 필수 필드)
    return {
      id: rowNumber,
      sheetRowNumber: rowNumber,
      timestampRaw: row['타임스탬프'],
      senderName: row['보내는분 성함'],
      status: row['비고'],
      syncStatus: syncMeta?.syncStatus || 'success',
      syncAttemptCount: syncMeta?.syncAttemptCount || 1,
    } as Partial<PrismaOrder>;
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
    this.confirmedCount = 0;
  }
}
