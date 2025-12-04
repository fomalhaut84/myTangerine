import { describe, it, expect, beforeEach } from 'vitest';
import { Config } from '../config/config.js';
import { LabelFormatter } from '../formatters/label-formatter.js';
import { sheetRowToOrder, type SheetRow } from '../types/order.js';

/**
 * 통합 테스트: SheetService → LabelFormatter
 * 실제 워크플로우를 시뮬레이션:
 * 1. SheetRow[] (Google Sheets에서 가져온 데이터)
 * 2. Order[] (sheetRowToOrder로 변환)
 * 3. string (LabelFormatter로 포맷팅)
 */
describe('Integration: SheetService + LabelFormatter', () => {
  let config: Config;
  let formatter: LabelFormatter;

  beforeEach(() => {
    config = {
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
        if (config.productPrices[yearStr]) {
          return config.productPrices[yearStr];
        }
        // Fallback to 2024
        return config.productPrices['2024'];
      },
      requiredColumns: [],
      spreadsheetName: 'test',
    } as Config;

    formatter = new LabelFormatter(config);
  });

  describe('End-to-End workflow', () => {
    it('should process complete order workflow from SheetRows to formatted labels', () => {
      // 1. 시뮬레이션: Google Sheets에서 가져온 원본 데이터
      const sheetRows: SheetRow[] = [
        {
          '타임스탬프': '2024. 12. 5. 오전 9:30:15',
          '비고': '',
          '보내는분 성함': '김철수',
          '보내는분 주소 (도로명 주소로 부탁드려요)': '서울시 강남구 테헤란로 123',
          '보내는분 연락처 (핸드폰번호)': '01012345678',
          '받으실분 성함': '이영희',
          '받으실분 주소 (도로명 주소로 부탁드려요)': '서울시 송파구 올림픽로 456',
          '받으실분 연락처 (핸드폰번호)': '01098765432',
          '상품 선택': '감귤 5kg',
          '5kg 수량': '2',
          '10kg 수량': '',
          _rowNumber: 2,
        },
        {
          '타임스탬프': '2024. 12. 5. 오후 2:15:30',
          '비고': '',
          '보내는분 성함': '박민수',
          '보내는분 주소 (도로명 주소로 부탁드려요)': '부산시 해운대구 해변로 789',
          '보내는분 연락처 (핸드폰번호)': '01055556666',
          '받으실분 성함': '최지훈',
          '받으실분 주소 (도로명 주소로 부탁드려요)': '대구시 수성구 범어로 321',
          '받으실분 연락처 (핸드폰번호)': '01077778888',
          '상품 선택': '감귤 10kg',
          '5kg 수량': '',
          '10kg 수량': 1,
          _rowNumber: 3,
        },
      ];

      // 2. SheetRow → Order 변환
      const orders = sheetRows.map((row) => sheetRowToOrder(row, config));

      // 3. LabelFormatter로 포맷팅
      const result = formatter.formatLabels(orders);

      // 4. 검증: 구조 확인
      expect(result).toContain('=== 2024-12-05 ===');

      // 발송인 1: 김철수
      expect(result).toContain('보내는사람');
      expect(result).toContain('서울시 강남구 테헤란로 123 김철수 010-1234-5678');
      expect(result).toContain('서울시 송파구 올림픽로 456 이영희 010-9876-5432');
      expect(result).toContain('5kg / 2박스');

      // 발송인 2: 박민수
      expect(result).toContain('부산시 해운대구 해변로 789 박민수 010-5555-6666');
      expect(result).toContain('대구시 수성구 범어로 321 최지훈 010-7777-8888');
      expect(result).toContain('10kg / 1박스');

      // 요약
      expect(result).toContain('주문 요약');
      expect(result).toContain('5kg 주문: 2박스 (40,000원)');
      expect(result).toContain('10kg 주문: 1박스 (35,000원)');
      expect(result).toContain('총 주문금액: 75,000원');
    });

    it('should handle empty sender info with defaultSender fallback', () => {
      const sheetRows: SheetRow[] = [
        {
          '타임스탬프': '2024. 12. 5. 오전 9:30:15',
          '비고': '',
          '보내는분 성함': '', // 빈 값
          '보내는분 주소 (도로명 주소로 부탁드려요)': '', // 빈 값
          '보내는분 연락처 (핸드폰번호)': '', // 빈 값
          '받으실분 성함': '이영희',
          '받으실분 주소 (도로명 주소로 부탁드려요)': '서울시 송파구 올림픽로 456',
          '받으실분 연락처 (핸드폰번호)': '01098765432',
          '상품 선택': '감귤 5kg',
          '5kg 수량': '1',
          '10kg 수량': '',
          _rowNumber: 2,
        },
      ];

      const orders = sheetRows.map((row) => sheetRowToOrder(row, config));
      const result = formatter.formatLabels(orders);

      // 기본 발송인 정보가 사용되어야 함
      expect(result).toContain('제주도 제주시 정실3길 113 기본발송인 010-6395-0618');
      expect(result).toContain('서울시 송파구 올림픽로 456 이영희 010-9876-5432');
    });

    it('should group multiple orders by date and sender', () => {
      const sheetRows: SheetRow[] = [
        // 날짜 1, 발송인 1, 주문 1
        {
          '타임스탬프': '2024. 12. 5. 오전 9:00:00',
          '비고': '',
          '보내는분 성함': '김철수',
          '보내는분 주소 (도로명 주소로 부탁드려요)': '서울시 강남구',
          '보내는분 연락처 (핸드폰번호)': '01012345678',
          '받으실분 성함': '수취인1',
          '받으실분 주소 (도로명 주소로 부탁드려요)': '주소1',
          '받으실분 연락처 (핸드폰번호)': '01011111111',
          '상품 선택': '5kg',
          '5kg 수량': '1',
          '10kg 수량': '',
          _rowNumber: 2,
        },
        // 날짜 1, 발송인 1, 주문 2
        {
          '타임스탬프': '2024. 12. 5. 오전 10:00:00',
          '비고': '',
          '보내는분 성함': '김철수',
          '보내는분 주소 (도로명 주소로 부탁드려요)': '서울시 강남구',
          '보내는분 연락처 (핸드폰번호)': '01012345678',
          '받으실분 성함': '수취인2',
          '받으실분 주소 (도로명 주소로 부탁드려요)': '주소2',
          '받으실분 연락처 (핸드폰번호)': '01022222222',
          '상품 선택': '5kg',
          '5kg 수량': '2',
          '10kg 수량': '',
          _rowNumber: 3,
        },
        // 날짜 1, 발송인 2
        {
          '타임스탬프': '2024. 12. 5. 오후 3:00:00',
          '비고': '',
          '보내는분 성함': '이영희',
          '보내는분 주소 (도로명 주소로 부탁드려요)': '서울시 송파구',
          '보내는분 연락처 (핸드폰번호)': '01098765432',
          '받으실분 성함': '수취인3',
          '받으실분 주소 (도로명 주소로 부탁드려요)': '주소3',
          '받으실분 연락처 (핸드폰번호)': '01033333333',
          '상품 선택': '10kg',
          '5kg 수량': '',
          '10kg 수량': 1,
          _rowNumber: 4,
        },
        // 날짜 2, 발송인 1
        {
          '타임스탬프': '2024. 12. 6. 오전 9:00:00',
          '비고': '',
          '보내는분 성함': '김철수',
          '보내는분 주소 (도로명 주소로 부탁드려요)': '서울시 강남구',
          '보내는분 연락처 (핸드폰번호)': '01012345678',
          '받으실분 성함': '수취인4',
          '받으실분 주소 (도로명 주소로 부탁드려요)': '주소4',
          '받으실분 연락처 (핸드폰번호)': '01044444444',
          '상품 선택': '5kg',
          '5kg 수량': '3',
          '10kg 수량': '',
          _rowNumber: 5,
        },
      ];

      const orders = sheetRows.map((row) => sheetRowToOrder(row, config));
      const result = formatter.formatLabels(orders);

      // 날짜 구분
      expect(result).toContain('=== 2024-12-05 ===');
      expect(result).toContain('=== 2024-12-06 ===');

      // 발송인 그룹화 확인: "보내는사람"이 3번 나타나야 함
      // (날짜1-발송인1, 날짜1-발송인2, 날짜2-발송인1)
      const senderMatches = result.match(/보내는사람/g);
      expect(senderMatches).toHaveLength(3);

      // 김철수 섹션에 수취인1, 수취인2가 함께 있어야 함
      const day1Section = result.split('=== 2024-12-06 ===')[0];
      const kimSection = day1Section.split('이영희')[0];
      expect(kimSection).toContain('수취인1');
      expect(kimSection).toContain('수취인2');

      // 전체 합산
      expect(result).toContain('5kg 주문: 6박스'); // 1 + 2 + 3
      expect(result).toContain('10kg 주문: 1박스');
    });

    it('should handle mixed product types from same sender', () => {
      const sheetRows: SheetRow[] = [
        {
          '타임스탬프': '2024. 12. 5. 오전 9:00:00',
          '비고': '',
          '보내는분 성함': '김철수',
          '보내는분 주소 (도로명 주소로 부탁드려요)': '서울시 강남구',
          '보내는분 연락처 (핸드폰번호)': '01012345678',
          '받으실분 성함': '수취인1',
          '받으실분 주소 (도로명 주소로 부탁드려요)': '주소1',
          '받으실분 연락처 (핸드폰번호)': '01011111111',
          '상품 선택': '5kg',
          '5kg 수량': '2',
          '10kg 수량': '',
          _rowNumber: 2,
        },
        {
          '타임스탬프': '2024. 12. 5. 오전 10:00:00',
          '비고': '',
          '보내는분 성함': '김철수',
          '보내는분 주소 (도로명 주소로 부탁드려요)': '서울시 강남구',
          '보내는분 연락처 (핸드폰번호)': '01012345678',
          '받으실분 성함': '수취인2',
          '받으실분 주소 (도로명 주소로 부탁드려요)': '주소2',
          '받으실분 연락처 (핸드폰번호)': '01022222222',
          '상품 선택': '10kg',
          '5kg 수량': '',
          '10kg 수량': 1,
          _rowNumber: 3,
        },
        {
          '타임스탬프': '2024. 12. 5. 오전 11:00:00',
          '비고': '',
          '보내는분 성함': '김철수',
          '보내는분 주소 (도로명 주소로 부탁드려요)': '서울시 강남구',
          '보내는분 연락처 (핸드폰번호)': '01012345678',
          '받으실분 성함': '수취인3',
          '받으실분 주소 (도로명 주소로 부탁드려요)': '주소3',
          '받으실분 연락처 (핸드폰번호)': '01033333333',
          '상품 선택': '5kg',
          '5kg 수량': '1',
          '10kg 수량': '',
          _rowNumber: 4,
        },
      ];

      const orders = sheetRows.map((row) => sheetRowToOrder(row, config));
      const result = formatter.formatLabels(orders);

      // 같은 발송인이므로 보내는사람은 1번만
      const senderMatches = result.match(/보내는사람/g);
      expect(senderMatches).toHaveLength(1);

      // 모든 수취인이 같은 발송인 아래 그룹화
      expect(result).toContain('수취인1');
      expect(result).toContain('수취인2');
      expect(result).toContain('수취인3');

      // 5kg과 10kg이 각각 추적됨
      expect(result).toContain('5kg / 2박스');
      expect(result).toContain('10kg / 1박스');
      expect(result).toContain('5kg / 1박스');

      // 요약
      expect(result).toContain('5kg 주문: 3박스 (60,000원)');
      expect(result).toContain('10kg 주문: 1박스 (35,000원)');
      expect(result).toContain('총 주문금액: 95,000원');
    });

    it('should correctly parse Korean timestamps and sort chronologically', () => {
      const sheetRows: SheetRow[] = [
        {
          '타임스탬프': '2024. 12. 5. 오후 11:59:59', // 가장 늦음
          '비고': '',
          '보내는분 성함': '김철수',
          '보내는분 주소 (도로명 주소로 부탁드려요)': '서울시 강남구',
          '보내는분 연락처 (핸드폰번호)': '01012345678',
          '받으실분 성함': '수취인3',
          '받으실분 주소 (도로명 주소로 부탁드려요)': '주소3',
          '받으실분 연락처 (핸드폰번호)': '01033333333',
          '상품 선택': '5kg',
          '5kg 수량': '1',
          '10kg 수량': '',
          _rowNumber: 4,
        },
        {
          '타임스탬프': '2024. 12. 5. 오전 12:00:01', // 가장 이름 (자정)
          '비고': '',
          '보내는분 성함': '김철수',
          '보내는분 주소 (도로명 주소로 부탁드려요)': '서울시 강남구',
          '보내는분 연락처 (핸드폰번호)': '01012345678',
          '받으실분 성함': '수취인1',
          '받으실분 주소 (도로명 주소로 부탁드려요)': '주소1',
          '받으실분 연락처 (핸드폰번호)': '01011111111',
          '상품 선택': '5kg',
          '5kg 수량': '1',
          '10kg 수량': '',
          _rowNumber: 2,
        },
        {
          '타임스탬프': '2024. 12. 5. 오후 12:00:00', // 정오
          '비고': '',
          '보내는분 성함': '김철수',
          '보내는분 주소 (도로명 주소로 부탁드려요)': '서울시 강남구',
          '보내는분 연락처 (핸드폰번호)': '01012345678',
          '받으실분 성함': '수취인2',
          '받으실분 주소 (도로명 주소로 부탁드려요)': '주소2',
          '받으실분 연락처 (핸드폰번호)': '01022222222',
          '상품 선택': '5kg',
          '5kg 수량': '1',
          '10kg 수량': '',
          _rowNumber: 3,
        },
      ];

      const orders = sheetRows.map((row) => sheetRowToOrder(row, config));
      const result = formatter.formatLabels(orders);

      // 시간순 정렬 확인: 수취인1 → 수취인2 → 수취인3
      const idx1 = result.indexOf('수취인1');
      const idx2 = result.indexOf('수취인2');
      const idx3 = result.indexOf('수취인3');

      expect(idx1).toBeLessThan(idx2);
      expect(idx2).toBeLessThan(idx3);
    });

    it('should format phone numbers consistently in the output', () => {
      const sheetRows: SheetRow[] = [
        {
          '타임스탬프': '2024. 12. 5. 오전 9:00:00',
          '비고': '',
          '보내는분 성함': '김철수',
          '보내는분 주소 (도로명 주소로 부탁드려요)': '서울시 강남구',
          '보내는분 연락처 (핸드폰번호)': '1012345678', // 0 없음
          '받으실분 성함': '이영희',
          '받으실분 주소 (도로명 주소로 부탁드려요)': '서울시 송파구',
          '받으실분 연락처 (핸드폰번호)': '010 9876 5432', // 공백 구분
          '상품 선택': '5kg',
          '5kg 수량': '1',
          '10kg 수량': '',
          _rowNumber: 2,
        },
      ];

      const orders = sheetRows.map((row) => sheetRowToOrder(row, config));
      const result = formatter.formatLabels(orders);

      // 포맷팅된 전화번호 확인
      expect(result).toContain('010-1234-5678'); // 0 추가 + 포맷팅
      expect(result).toContain('010-9876-5432'); // 공백 제거 + 포맷팅
    });
  });

  describe('Edge cases', () => {
    it('should handle no orders gracefully', () => {
      const sheetRows: SheetRow[] = [];
      const orders = sheetRows.map((row) => sheetRowToOrder(row, config));
      const result = formatter.formatLabels(orders);

      expect(result).toBe('새로운 주문이 없습니다.');
    });

    it('should handle large quantities', () => {
      const sheetRows: SheetRow[] = [
        {
          '타임스탬프': '2024. 12. 5. 오전 9:00:00',
          '비고': '',
          '보내는분 성함': '김철수',
          '보내는분 주소 (도로명 주소로 부탁드려요)': '서울시 강남구',
          '보내는분 연락처 (핸드폰번호)': '01012345678',
          '받으실분 성함': '이영희',
          '받으실분 주소 (도로명 주소로 부탁드려요)': '서울시 송파구',
          '받으실분 연락처 (핸드폰번호)': '01098765432',
          '상품 선택': '5kg',
          '5kg 수량': '100',
          '10kg 수량': '',
          _rowNumber: 2,
        },
      ];

      const orders = sheetRows.map((row) => sheetRowToOrder(row, config));
      const result = formatter.formatLabels(orders);

      expect(result).toContain('5kg / 100박스');
      expect(result).toContain('5kg 주문: 100박스 (2,000,000원)');
    });
  });
});
