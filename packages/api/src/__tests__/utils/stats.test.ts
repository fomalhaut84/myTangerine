/**
 * 시즌 필터링 함수 테스트
 * Issue #142: Seasonal scope
 */

import { describe, it, expect } from 'vitest';
import {
  filterOrdersBySeason,
  isSeasonalScope,
  PEAK_SEASON_MONTHS,
  OFF_SEASON_MONTHS,
} from '../../utils/stats.js';
import type { Order } from '@mytangerine/core';

// 테스트용 주문 생성 헬퍼
function createMockOrder(month: number, year: number = 2024): Order {
  const timestamp = new Date(year, month - 1, 15); // 해당 월 15일로 설정
  return {
    id: `order-${year}-${month}`,
    timestamp,
    status: '배송완료',
    orderer: { name: '테스트', phone: '010-1234-5678' },
    recipient: {
      name: '수령인',
      phone: '010-8765-4321',
      address: '제주시',
      postalCode: '63000',
    },
    productType: '5kg',
    quantity: 1,
    orderType: 'customer',
    remarks: '',
  };
}

describe('filterOrdersBySeason', () => {
  describe('성수기 필터링 (peak_season: 10~2월)', () => {
    it('10월 주문을 포함해야 함', () => {
      const orders = [createMockOrder(10)];
      const result = filterOrdersBySeason(orders, 'peak_season');
      expect(result).toHaveLength(1);
    });

    it('11월 주문을 포함해야 함', () => {
      const orders = [createMockOrder(11)];
      const result = filterOrdersBySeason(orders, 'peak_season');
      expect(result).toHaveLength(1);
    });

    it('12월 주문을 포함해야 함', () => {
      const orders = [createMockOrder(12)];
      const result = filterOrdersBySeason(orders, 'peak_season');
      expect(result).toHaveLength(1);
    });

    it('1월 주문을 포함해야 함', () => {
      const orders = [createMockOrder(1)];
      const result = filterOrdersBySeason(orders, 'peak_season');
      expect(result).toHaveLength(1);
    });

    it('2월 주문을 포함해야 함', () => {
      const orders = [createMockOrder(2)];
      const result = filterOrdersBySeason(orders, 'peak_season');
      expect(result).toHaveLength(1);
    });

    it('3월 주문을 제외해야 함 (비수기 시작)', () => {
      const orders = [createMockOrder(3)];
      const result = filterOrdersBySeason(orders, 'peak_season');
      expect(result).toHaveLength(0);
    });

    it('9월 주문을 제외해야 함 (비수기 끝)', () => {
      const orders = [createMockOrder(9)];
      const result = filterOrdersBySeason(orders, 'peak_season');
      expect(result).toHaveLength(0);
    });
  });

  describe('비수기 필터링 (off_season: 3~9월)', () => {
    it('3월 주문을 포함해야 함 (비수기 시작)', () => {
      const orders = [createMockOrder(3)];
      const result = filterOrdersBySeason(orders, 'off_season');
      expect(result).toHaveLength(1);
    });

    it('9월 주문을 포함해야 함 (비수기 끝)', () => {
      const orders = [createMockOrder(9)];
      const result = filterOrdersBySeason(orders, 'off_season');
      expect(result).toHaveLength(1);
    });

    it('6월 주문을 포함해야 함 (비수기 중간)', () => {
      const orders = [createMockOrder(6)];
      const result = filterOrdersBySeason(orders, 'off_season');
      expect(result).toHaveLength(1);
    });

    it('10월 주문을 제외해야 함 (성수기 시작)', () => {
      const orders = [createMockOrder(10)];
      const result = filterOrdersBySeason(orders, 'off_season');
      expect(result).toHaveLength(0);
    });

    it('2월 주문을 제외해야 함 (성수기 끝)', () => {
      const orders = [createMockOrder(2)];
      const result = filterOrdersBySeason(orders, 'off_season');
      expect(result).toHaveLength(0);
    });
  });

  describe('연도 경계 테스트', () => {
    it('12월에서 1월로 넘어가는 주문 모두 성수기로 분류되어야 함', () => {
      const orders = [
        createMockOrder(12, 2024),
        createMockOrder(1, 2025),
      ];
      const result = filterOrdersBySeason(orders, 'peak_season');
      expect(result).toHaveLength(2);
    });

    it('2월에서 3월로 넘어갈 때 경계 처리', () => {
      const orders = [
        createMockOrder(2, 2024), // 성수기 끝
        createMockOrder(3, 2024), // 비수기 시작
      ];
      const peakResult = filterOrdersBySeason(orders, 'peak_season');
      const offResult = filterOrdersBySeason(orders, 'off_season');
      expect(peakResult).toHaveLength(1);
      expect(offResult).toHaveLength(1);
    });

    it('9월에서 10월로 넘어갈 때 경계 처리', () => {
      const orders = [
        createMockOrder(9, 2024), // 비수기 끝
        createMockOrder(10, 2024), // 성수기 시작
      ];
      const peakResult = filterOrdersBySeason(orders, 'peak_season');
      const offResult = filterOrdersBySeason(orders, 'off_season');
      expect(peakResult).toHaveLength(1);
      expect(offResult).toHaveLength(1);
    });
  });

  describe('혼합 주문 테스트', () => {
    it('1년치 주문에서 성수기만 필터링', () => {
      const orders = Array.from({ length: 12 }, (_, i) => createMockOrder(i + 1));
      const result = filterOrdersBySeason(orders, 'peak_season');
      // 성수기: 1, 2, 10, 11, 12 = 5개월
      expect(result).toHaveLength(5);
    });

    it('1년치 주문에서 비수기만 필터링', () => {
      const orders = Array.from({ length: 12 }, (_, i) => createMockOrder(i + 1));
      const result = filterOrdersBySeason(orders, 'off_season');
      // 비수기: 3, 4, 5, 6, 7, 8, 9 = 7개월
      expect(result).toHaveLength(7);
    });

    it('빈 배열 처리', () => {
      const result = filterOrdersBySeason([], 'peak_season');
      expect(result).toHaveLength(0);
    });
  });
});

describe('isSeasonalScope', () => {
  it('peak_season은 true를 반환해야 함', () => {
    expect(isSeasonalScope('peak_season')).toBe(true);
  });

  it('off_season은 true를 반환해야 함', () => {
    expect(isSeasonalScope('off_season')).toBe(true);
  });

  it('completed는 false를 반환해야 함', () => {
    expect(isSeasonalScope('completed')).toBe(false);
  });

  it('new는 false를 반환해야 함', () => {
    expect(isSeasonalScope('new')).toBe(false);
  });

  it('all은 false를 반환해야 함', () => {
    expect(isSeasonalScope('all')).toBe(false);
  });

  it('pending_payment는 false를 반환해야 함', () => {
    expect(isSeasonalScope('pending_payment')).toBe(false);
  });
});

describe('상수 검증', () => {
  it('PEAK_SEASON_MONTHS는 10, 11, 12, 1, 2를 포함해야 함', () => {
    expect(PEAK_SEASON_MONTHS).toEqual([10, 11, 12, 1, 2]);
  });

  it('OFF_SEASON_MONTHS는 3, 4, 5, 6, 7, 8, 9를 포함해야 함', () => {
    expect(OFF_SEASON_MONTHS).toEqual([3, 4, 5, 6, 7, 8, 9]);
  });

  it('성수기와 비수기 합이 12개월이어야 함', () => {
    expect(PEAK_SEASON_MONTHS.length + OFF_SEASON_MONTHS.length).toBe(12);
  });

  it('성수기와 비수기에 중복이 없어야 함', () => {
    const overlap = PEAK_SEASON_MONTHS.filter(m => OFF_SEASON_MONTHS.includes(m));
    expect(overlap).toHaveLength(0);
  });
});
