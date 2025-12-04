import { describe, it, expect, beforeEach } from 'vitest';
import { LabelFormatter } from '../label-formatter.js';
import { Config } from '../../config/config.js';
import type { Order } from '../../types/order.js';

describe('LabelFormatter', () => {
  let formatter: LabelFormatter;
  let mockConfig: Config;

  beforeEach(() => {
    mockConfig = {
      defaultSender: {
        name: '기본발송인',
        address: '제주도 제주시 정실3길 113',
        phone: '010-6395-0618',
      },
      productPrices: {
        '2024': {
          '5kg': 20000,
          '10kg': 35000,
        },
        '2025': {
          '5kg': 23000,
          '10kg': 38000,
        },
      },
      getPricesForYear: (year: number) => {
        const yearStr = year.toString();
        if (mockConfig.productPrices[yearStr]) {
          return mockConfig.productPrices[yearStr];
        }
        // Fallback to 2024
        return mockConfig.productPrices['2024'];
      },
      requiredColumns: [],
      spreadsheetName: 'test',
    } as Config;

    formatter = new LabelFormatter(mockConfig);
  });

  describe('formatLabels', () => {
    it('should return message when no orders', () => {
      const result = formatter.formatLabels([]);
      expect(result).toBe('새로운 주문이 없습니다.');
    });

    it('should format single order correctly', () => {
      const orders: Order[] = [
        {
          timestamp: new Date('2024-12-05T15:45:23'),
          timestampRaw: '2024. 12. 5. 오후 3:45:23',
          status: '',
          sender: {
            name: '김철수',
            address: '서울시 강남구 테헤란로 123',
            phone: '010-1234-5678',
          },
          recipient: {
            name: '이영희',
            address: '서울시 송파구 올림픽로 456',
            phone: '010-9876-5432',
          },
          productType: '5kg',
          quantity: 2,
          rowNumber: 5,
        },
      ];

      const result = formatter.formatLabels(orders);

      // 날짜 헤더 확인
      expect(result).toContain('=== 2024-12-05 ===');

      // 발송인 정보 확인
      expect(result).toContain('보내는사람');
      expect(result).toContain('서울시 강남구 테헤란로 123 김철수 010-1234-5678');

      // 수취인 정보 확인
      expect(result).toContain('받는사람');
      expect(result).toContain('서울시 송파구 올림픽로 456 이영희 010-9876-5432');

      // 상품 정보 확인
      expect(result).toContain('주문상품');
      expect(result).toContain('5kg / 2박스');

      // 요약 확인
      expect(result).toContain('주문 요약');
      expect(result).toContain('5kg 주문: 2박스 (40,000원)');
      expect(result).toContain('10kg 주문: 0박스 (0원)');
      expect(result).toContain('총 주문금액: 40,000원');
    });

    it('should use defaultSender when sender info is invalid', () => {
      const orders: Order[] = [
        {
          timestamp: new Date('2024-12-05T15:45:23'),
          timestampRaw: '2024. 12. 5. 오후 3:45:23',
          status: '',
          sender: {
            name: '',
            address: '',
            phone: '',
          },
          recipient: {
            name: '이영희',
            address: '서울시 송파구 올림픽로 456',
            phone: '010-9876-5432',
          },
          productType: '5kg',
          quantity: 1,
          rowNumber: 5,
        },
      ];

      const result = formatter.formatLabels(orders);

      // 기본 발송인 정보 확인
      expect(result).toContain('제주도 제주시 정실3길 113 기본발송인 010-6395-0618');
    });

    it('should group orders by date', () => {
      const orders: Order[] = [
        {
          timestamp: new Date('2024-12-05T09:30:00'),
          timestampRaw: '2024. 12. 5. 오전 9:30:00',
          status: '',
          sender: {
            name: '김철수',
            address: '서울시 강남구',
            phone: '010-1234-5678',
          },
          recipient: {
            name: '수취인1',
            address: '주소1',
            phone: '010-1111-1111',
          },
          productType: '5kg',
          quantity: 1,
          rowNumber: 2,
        },
        {
          timestamp: new Date('2024-12-06T09:30:00'),
          timestampRaw: '2024. 12. 6. 오전 9:30:00',
          status: '',
          sender: {
            name: '김철수',
            address: '서울시 강남구',
            phone: '010-1234-5678',
          },
          recipient: {
            name: '수취인2',
            address: '주소2',
            phone: '010-2222-2222',
          },
          productType: '5kg',
          quantity: 1,
          rowNumber: 3,
        },
      ];

      const result = formatter.formatLabels(orders);

      // 두 날짜 헤더가 모두 있는지 확인
      expect(result).toContain('=== 2024-12-05 ===');
      expect(result).toContain('=== 2024-12-06 ===');

      // 날짜별로 정렬되어 있는지 확인 (2024-12-05가 먼저)
      const date1Index = result.indexOf('2024-12-05');
      const date2Index = result.indexOf('2024-12-06');
      expect(date1Index).toBeLessThan(date2Index);
    });

    it('should group orders by sender within same date', () => {
      const orders: Order[] = [
        {
          timestamp: new Date('2024-12-05T09:30:00'),
          timestampRaw: '2024. 12. 5. 오전 9:30:00',
          status: '',
          sender: {
            name: '김철수',
            address: '서울시 강남구',
            phone: '010-1234-5678',
          },
          recipient: {
            name: '수취인1',
            address: '주소1',
            phone: '010-1111-1111',
          },
          productType: '5kg',
          quantity: 1,
          rowNumber: 2,
        },
        {
          timestamp: new Date('2024-12-05T10:00:00'),
          timestampRaw: '2024. 12. 5. 오전 10:00:00',
          status: '',
          sender: {
            name: '이영희',
            address: '서울시 송파구',
            phone: '010-9876-5432',
          },
          recipient: {
            name: '수취인2',
            address: '주소2',
            phone: '010-2222-2222',
          },
          productType: '5kg',
          quantity: 1,
          rowNumber: 3,
        },
        {
          timestamp: new Date('2024-12-05T11:00:00'),
          timestampRaw: '2024. 12. 5. 오전 11:00:00',
          status: '',
          sender: {
            name: '김철수',
            address: '서울시 강남구',
            phone: '010-1234-5678',
          },
          recipient: {
            name: '수취인3',
            address: '주소3',
            phone: '010-3333-3333',
          },
          productType: '10kg',
          quantity: 2,
          rowNumber: 4,
        },
      ];

      const result = formatter.formatLabels(orders);

      // 같은 날짜 헤더는 하나만 있어야 함
      const dateHeaders = result.match(/=== 2024-12-05 ===/g);
      expect(dateHeaders).toHaveLength(1);

      // 발송인 정보가 두 번 나타나야 함 (김철수, 이영희)
      const senderHeaders = result.match(/보내는사람/g);
      expect(senderHeaders).toHaveLength(2);

      // 김철수의 주문 2개가 함께 그룹화되어야 함
      const kimSection = result.split('이영희')[0];
      expect(kimSection).toContain('수취인1');
      expect(kimSection).toContain('수취인3');
    });

    it('should track 5kg and 10kg quantities separately', () => {
      const orders: Order[] = [
        {
          timestamp: new Date('2024-12-05T09:30:00'),
          timestampRaw: '2024. 12. 5. 오전 9:30:00',
          status: '',
          sender: {
            name: '김철수',
            address: '서울시 강남구',
            phone: '010-1234-5678',
          },
          recipient: {
            name: '수취인1',
            address: '주소1',
            phone: '010-1111-1111',
          },
          productType: '5kg',
          quantity: 3,
          rowNumber: 2,
        },
        {
          timestamp: new Date('2024-12-05T10:00:00'),
          timestampRaw: '2024. 12. 5. 오전 10:00:00',
          status: '',
          sender: {
            name: '김철수',
            address: '서울시 강남구',
            phone: '010-1234-5678',
          },
          recipient: {
            name: '수취인2',
            address: '주소2',
            phone: '010-2222-2222',
          },
          productType: '10kg',
          quantity: 2,
          rowNumber: 3,
        },
        {
          timestamp: new Date('2024-12-05T11:00:00'),
          timestampRaw: '2024. 12. 5. 오전 11:00:00',
          status: '',
          sender: {
            name: '김철수',
            address: '서울시 강남구',
            phone: '010-1234-5678',
          },
          recipient: {
            name: '수취인3',
            address: '주소3',
            phone: '010-3333-3333',
          },
          productType: '5kg',
          quantity: 1,
          rowNumber: 4,
        },
      ];

      const result = formatter.formatLabels(orders);

      // 요약에서 합산 확인
      expect(result).toContain('5kg 주문: 4박스 (80,000원)'); // 3 + 1
      expect(result).toContain('10kg 주문: 2박스 (70,000원)');
      expect(result).toContain('총 주문금액: 150,000원'); // 80000 + 70000
    });

    it('should format complex scenario with multiple dates and senders', () => {
      const orders: Order[] = [
        {
          timestamp: new Date('2024-12-05T09:30:00'),
          timestampRaw: '2024. 12. 5. 오전 9:30:00',
          status: '',
          sender: {
            name: '김철수',
            address: '서울시 강남구',
            phone: '010-1234-5678',
          },
          recipient: {
            name: '수취인1',
            address: '주소1',
            phone: '010-1111-1111',
          },
          productType: '5kg',
          quantity: 2,
          rowNumber: 2,
        },
        {
          timestamp: new Date('2024-12-05T10:00:00'),
          timestampRaw: '2024. 12. 5. 오전 10:00:00',
          status: '',
          sender: {
            name: '이영희',
            address: '서울시 송파구',
            phone: '010-9876-5432',
          },
          recipient: {
            name: '수취인2',
            address: '주소2',
            phone: '010-2222-2222',
          },
          productType: '10kg',
          quantity: 1,
          rowNumber: 3,
        },
        {
          timestamp: new Date('2024-12-06T09:30:00'),
          timestampRaw: '2024. 12. 6. 오전 9:30:00',
          status: '',
          sender: {
            name: '김철수',
            address: '서울시 강남구',
            phone: '010-1234-5678',
          },
          recipient: {
            name: '수취인3',
            address: '주소3',
            phone: '010-3333-3333',
          },
          productType: '5kg',
          quantity: 3,
          rowNumber: 4,
        },
      ];

      const result = formatter.formatLabels(orders);

      // 구조 검증
      expect(result).toContain('=== 2024-12-05 ===');
      expect(result).toContain('=== 2024-12-06 ===');
      expect(result).toContain('주문 요약');

      // 전체 합산 확인
      expect(result).toContain('5kg 주문: 5박스 (100,000원)');
      expect(result).toContain('10kg 주문: 1박스 (35,000원)');
      expect(result).toContain('총 주문금액: 135,000원');
    });

    it('should reset totals between formatLabels calls', () => {
      const orders1: Order[] = [
        {
          timestamp: new Date('2024-12-05T09:30:00'),
          timestampRaw: '2024. 12. 5. 오전 9:30:00',
          status: '',
          sender: {
            name: '김철수',
            address: '서울시 강남구',
            phone: '010-1234-5678',
          },
          recipient: {
            name: '수취인1',
            address: '주소1',
            phone: '010-1111-1111',
          },
          productType: '5kg',
          quantity: 2,
          rowNumber: 2,
        },
      ];

      const result1 = formatter.formatLabels(orders1);
      expect(result1).toContain('5kg 주문: 2박스');

      // 두 번째 호출
      const orders2: Order[] = [
        {
          timestamp: new Date('2024-12-06T09:30:00'),
          timestampRaw: '2024. 12. 6. 오전 9:30:00',
          status: '',
          sender: {
            name: '이영희',
            address: '서울시 송파구',
            phone: '010-9876-5432',
          },
          recipient: {
            name: '수취인2',
            address: '주소2',
            phone: '010-2222-2222',
          },
          productType: '5kg',
          quantity: 1,
          rowNumber: 3,
        },
      ];

      const result2 = formatter.formatLabels(orders2);
      expect(result2).toContain('5kg 주문: 1박스'); // 2 + 1 = 3이 아닌 1이어야 함
    });

    it('should sort orders by timestamp within groups', () => {
      const orders: Order[] = [
        {
          timestamp: new Date('2024-12-05T15:00:00'), // 나중
          timestampRaw: '2024. 12. 5. 오후 3:00:00',
          status: '',
          sender: {
            name: '김철수',
            address: '서울시 강남구',
            phone: '010-1234-5678',
          },
          recipient: {
            name: '수취인2',
            address: '주소2',
            phone: '010-2222-2222',
          },
          productType: '5kg',
          quantity: 1,
          rowNumber: 3,
        },
        {
          timestamp: new Date('2024-12-05T09:00:00'), // 먼저
          timestampRaw: '2024. 12. 5. 오전 9:00:00',
          status: '',
          sender: {
            name: '김철수',
            address: '서울시 강남구',
            phone: '010-1234-5678',
          },
          recipient: {
            name: '수취인1',
            address: '주소1',
            phone: '010-1111-1111',
          },
          productType: '5kg',
          quantity: 1,
          rowNumber: 2,
        },
      ];

      const result = formatter.formatLabels(orders);

      // 수취인1이 수취인2보다 먼저 나와야 함
      const recipient1Index = result.indexOf('수취인1');
      const recipient2Index = result.indexOf('수취인2');
      expect(recipient1Index).toBeLessThan(recipient2Index);
    });

    it('should correctly calculate prices for mixed year orders', () => {
      // 2024년과 2025년 주문이 섞여있는 경우
      const orders: Order[] = [
        {
          timestamp: new Date('2024-12-05T15:45:23'),
          timestampRaw: '2024. 12. 5. 오후 3:45:23',
          status: '',
          sender: {
            name: '김철수',
            address: '서울시 강남구',
            phone: '010-1234-5678',
          },
          recipient: {
            name: '수취인1',
            address: '주소1',
            phone: '010-1111-1111',
          },
          productType: '5kg',
          quantity: 1, // 2024년 가격: 20,000원
          rowNumber: 2,
        },
        {
          timestamp: new Date('2025-01-10T10:30:00'),
          timestampRaw: '2025. 1. 10. 오전 10:30:00',
          status: '',
          sender: {
            name: '이영희',
            address: '부산시 해운대구',
            phone: '010-9876-5432',
          },
          recipient: {
            name: '수취인2',
            address: '주소2',
            phone: '010-2222-2222',
          },
          productType: '5kg',
          quantity: 1, // 2025년 가격: 23,000원
          rowNumber: 3,
        },
        {
          timestamp: new Date('2024-11-20T09:15:00'),
          timestampRaw: '2024. 11. 20. 오전 9:15:00',
          status: '',
          sender: {
            name: '박민수',
            address: '대전시 유성구',
            phone: '010-5555-6666',
          },
          recipient: {
            name: '수취인3',
            address: '주소3',
            phone: '010-3333-3333',
          },
          productType: '10kg',
          quantity: 1, // 2024년 가격: 35,000원
          rowNumber: 4,
        },
        {
          timestamp: new Date('2025-02-14T14:20:00'),
          timestampRaw: '2025. 2. 14. 오후 2:20:00',
          status: '',
          sender: {
            name: '최지훈',
            address: '광주시 동구',
            phone: '010-7777-8888',
          },
          recipient: {
            name: '수취인4',
            address: '주소4',
            phone: '010-4444-4444',
          },
          productType: '10kg',
          quantity: 1, // 2025년 가격: 38,000원
          rowNumber: 5,
        },
      ];

      const result = formatter.formatLabels(orders);

      // 요약 정보 검증
      // 5kg: 2024(1) + 2025(1) = 2박스
      // 10kg: 2024(1) + 2025(1) = 2박스
      expect(result).toContain('5kg 주문: 2박스');
      expect(result).toContain('10kg 주문: 2박스');

      // 금액 검증
      // 5kg: 20,000 (2024) + 23,000 (2025) = 43,000원
      // 10kg: 35,000 (2024) + 38,000 (2025) = 73,000원
      // 총: 116,000원
      expect(result).toContain('5kg 주문: 2박스 (43,000원)');
      expect(result).toContain('10kg 주문: 2박스 (73,000원)');
      expect(result).toContain('총 주문금액: 116,000원');
    });

    it('should handle orders in reverse chronological order', () => {
      // 최신 주문이 먼저 오는 경우 (정렬되지 않은 입력)
      const orders: Order[] = [
        {
          timestamp: new Date('2025-01-15T16:00:00'),
          timestampRaw: '2025. 1. 15. 오후 4:00:00',
          status: '',
          sender: {
            name: '김철수',
            address: '서울시 강남구',
            phone: '010-1234-5678',
          },
          recipient: {
            name: '수취인1',
            address: '주소1',
            phone: '010-1111-1111',
          },
          productType: '5kg',
          quantity: 1, // 2025년: 23,000원
          rowNumber: 2,
        },
        {
          timestamp: new Date('2024-12-01T09:00:00'),
          timestampRaw: '2024. 12. 1. 오전 9:00:00',
          status: '',
          sender: {
            name: '이영희',
            address: '부산시 해운대구',
            phone: '010-9876-5432',
          },
          recipient: {
            name: '수취인2',
            address: '주소2',
            phone: '010-2222-2222',
          },
          productType: '5kg',
          quantity: 1, // 2024년: 20,000원
          rowNumber: 3,
        },
      ];

      const result = formatter.formatLabels(orders);

      // 금액이 정확히 계산되어야 함 (순서와 무관하게)
      // 5kg: 23,000 (2025) + 20,000 (2024) = 43,000원
      expect(result).toContain('5kg 주문: 2박스 (43,000원)');
      expect(result).toContain('총 주문금액: 43,000원');
    });

    it('should use oldest available price for orders older than configured years', () => {
      // 설정된 가격(2024, 2025)보다 이전 년도(2023) 주문인 경우
      // 가장 오래된 가격(2024년 가격) 사용해야 함
      const orders: Order[] = [
        {
          timestamp: new Date('2023-12-01T10:00:00'),
          timestampRaw: '2023. 12. 1. 오전 10:00:00',
          status: '',
          sender: {
            name: '김철수',
            address: '서울시 강남구',
            phone: '010-1234-5678',
          },
          recipient: {
            name: '수취인1',
            address: '주소1',
            phone: '010-1111-1111',
          },
          productType: '5kg',
          quantity: 1, // 2023년이지만 2024년 가격(20,000원) 사용해야 함
          rowNumber: 2,
        },
      ];

      const result = formatter.formatLabels(orders);

      // 2024년 가격이 사용되어야 함
      expect(result).toContain('5kg 주문: 1박스 (20,000원)');
      expect(result).toContain('총 주문금액: 20,000원');
    });
  });
});
