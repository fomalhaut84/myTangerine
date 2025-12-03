import { describe, it, expect } from 'vitest';
import {
  parseKoreanTimestamp,
  formatPhoneNumber,
  extractQuantity,
  sheetRowToOrder,
  validateProductSelection,
  type SheetRow,
} from '../order.js';
import { Config } from '../../config/config.js';

describe('parseKoreanTimestamp', () => {
  it('should parse 오전 (AM) timestamp correctly', () => {
    const result = parseKoreanTimestamp('2024. 12. 5. 오전 9:30:15');
    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(11); // 0-based (December)
    expect(result.getDate()).toBe(5);
    expect(result.getHours()).toBe(9);
    expect(result.getMinutes()).toBe(30);
    expect(result.getSeconds()).toBe(15);
  });

  it('should parse 오후 (PM) timestamp correctly', () => {
    const result = parseKoreanTimestamp('2024. 12. 5. 오후 3:45:23');
    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(11); // 0-based (December)
    expect(result.getDate()).toBe(5);
    expect(result.getHours()).toBe(15); // 3 PM = 15:00
    expect(result.getMinutes()).toBe(45);
    expect(result.getSeconds()).toBe(23);
  });

  it('should handle 12 AM correctly (midnight)', () => {
    const result = parseKoreanTimestamp('2024. 12. 5. 오전 12:00:00');
    expect(result.getHours()).toBe(0); // 12 AM = 00:00
  });

  it('should handle 12 PM correctly (noon)', () => {
    const result = parseKoreanTimestamp('2024. 12. 5. 오후 12:00:00');
    expect(result.getHours()).toBe(12); // 12 PM = 12:00
  });

  it('should throw error for invalid format', () => {
    expect(() => parseKoreanTimestamp('invalid')).toThrow('Failed to parse timestamp');
  });
});

describe('formatPhoneNumber', () => {
  it('should format 11-digit phone number with 010 prefix', () => {
    expect(formatPhoneNumber('01012345678')).toBe('010-1234-5678');
  });

  it('should add missing leading 0 to 10-digit number starting with 10', () => {
    expect(formatPhoneNumber('1012345678')).toBe('010-1234-5678');
  });

  it('should preserve already formatted phone numbers', () => {
    expect(formatPhoneNumber('010-1234-5678')).toBe('010-1234-5678');
  });

  it('should handle phone numbers with various separators', () => {
    expect(formatPhoneNumber('010 1234 5678')).toBe('010-1234-5678');
    expect(formatPhoneNumber('010.1234.5678')).toBe('010-1234-5678');
  });

  it('should return empty string for empty input', () => {
    expect(formatPhoneNumber('')).toBe('');
    expect(formatPhoneNumber('   ')).toBe('');
  });

  it('should return original for non-standard formats', () => {
    expect(formatPhoneNumber('02-1234-5678')).toBe('02-1234-5678');
  });
});

describe('extractQuantity', () => {
  it('should extract 5kg quantity when provided', () => {
    const row: SheetRow = {
      '타임스탬프': '2024. 12. 5. 오후 3:45:23',
      '비고': '',
      '보내는분 성함': '김철수',
      '보내는분 주소 (도로명 주소로 부탁드려요)': '서울시 강남구',
      '보내는분 연락처 (핸드폰번호)': '010-1234-5678',
      '받으실분 성함': '이영희',
      '받으실분 주소 (도로명 주소로 부탁드려요)': '서울시 송파구',
      '받으실분 연락처 (핸드폰번호)': '010-9876-5432',
      '상품 선택': '5kg',
      '5kg 수량': '3',
      '10kg 수량': '',
    };
    expect(extractQuantity(row)).toBe(3);
  });

  it('should extract 10kg quantity when 5kg is empty', () => {
    const row: SheetRow = {
      '타임스탬프': '2024. 12. 5. 오후 3:45:23',
      '비고': '',
      '보내는분 성함': '김철수',
      '보내는분 주소 (도로명 주소로 부탁드려요)': '서울시 강남구',
      '보내는분 연락처 (핸드폰번호)': '010-1234-5678',
      '받으실분 성함': '이영희',
      '받으실분 주소 (도로명 주소로 부탁드려요)': '서울시 송파구',
      '받으실분 연락처 (핸드폰번호)': '010-9876-5432',
      '상품 선택': '10kg',
      '5kg 수량': '',
      '10kg 수량': 2,
    };
    expect(extractQuantity(row)).toBe(2);
  });

  it('should return 1 as default when both quantities are empty', () => {
    const row: SheetRow = {
      '타임스탬프': '2024. 12. 5. 오후 3:45:23',
      '비고': '',
      '보내는분 성함': '김철수',
      '보내는분 주소 (도로명 주소로 부탁드려요)': '서울시 강남구',
      '보내는분 연락처 (핸드폰번호)': '010-1234-5678',
      '받으실분 성함': '이영희',
      '받으실분 주소 (도로명 주소로 부탁드려요)': '서울시 송파구',
      '받으실분 연락처 (핸드폰번호)': '010-9876-5432',
      '상품 선택': '5kg',
      '5kg 수량': '',
      '10kg 수량': '',
    };
    expect(extractQuantity(row)).toBe(1);
  });
});

describe('validateProductSelection', () => {
  describe('valid product types', () => {
    it('should accept "5kg"', () => {
      const result = validateProductSelection('5kg');
      expect(result.isValid).toBe(true);
      expect(result.productType).toBe('5kg');
      expect(result.reason).toBe('');
    });

    it('should accept "10kg"', () => {
      const result = validateProductSelection('10kg');
      expect(result.isValid).toBe(true);
      expect(result.productType).toBe('10kg');
      expect(result.reason).toBe('');
    });

    it('should accept "감귤 5kg" (5kg with prefix)', () => {
      const result = validateProductSelection('감귤 5kg');
      expect(result.isValid).toBe(true);
      expect(result.productType).toBe('5kg');
      expect(result.reason).toBe('');
    });

    it('should accept "감귤 10kg" (10kg with prefix)', () => {
      const result = validateProductSelection('감귤 10kg');
      expect(result.isValid).toBe(true);
      expect(result.productType).toBe('10kg');
      expect(result.reason).toBe('');
    });

    it('should accept "5kg 감귤" (5kg with suffix)', () => {
      const result = validateProductSelection('5kg 감귤');
      expect(result.isValid).toBe(true);
      expect(result.productType).toBe('5kg');
      expect(result.reason).toBe('');
    });

    it('should accept "비상품"', () => {
      const result = validateProductSelection('비상품');
      expect(result.isValid).toBe(true);
      expect(result.productType).toBe('비상품');
      expect(result.reason).toBe('');
    });

    it('should accept "비상품 (18,000 / box)"', () => {
      const result = validateProductSelection('비상품 (18,000 / box)');
      expect(result.isValid).toBe(true);
      expect(result.productType).toBe('비상품');
      expect(result.reason).toBe('');
    });

    it('should accept "비상품 (17,000 / 1상자)"', () => {
      const result = validateProductSelection('비상품 (17,000 / 1상자)');
      expect(result.isValid).toBe(true);
      expect(result.productType).toBe('비상품');
      expect(result.reason).toBe('');
    });
  });

  describe('invalid product types', () => {
    it('should reject "15kg"', () => {
      const result = validateProductSelection('15kg');
      expect(result.isValid).toBe(false);
      expect(result.productType).toBeNull();
      expect(result.reason).toContain('유효하지 않은 상품 타입');
    });

    it('should reject "310kg"', () => {
      const result = validateProductSelection('310kg');
      expect(result.isValid).toBe(false);
      expect(result.productType).toBeNull();
      expect(result.reason).toContain('유효하지 않은 상품 타입');
    });

    it('should reject "3kg"', () => {
      const result = validateProductSelection('3kg');
      expect(result.isValid).toBe(false);
      expect(result.productType).toBeNull();
      expect(result.reason).toContain('유효하지 않은 상품 타입');
    });

    it('should reject "20kg"', () => {
      const result = validateProductSelection('20kg');
      expect(result.isValid).toBe(false);
      expect(result.productType).toBeNull();
      expect(result.reason).toContain('유효하지 않은 상품 타입');
    });

    it('should reject "상품 (28,000 / 1상자)"', () => {
      const result = validateProductSelection('상품 (28,000 / 1상자)');
      expect(result.isValid).toBe(false);
      expect(result.productType).toBeNull();
      expect(result.reason).toContain('유효하지 않은 상품 타입');
    });
  });

  describe('empty or missing values', () => {
    it('should reject empty string', () => {
      const result = validateProductSelection('');
      expect(result.isValid).toBe(false);
      expect(result.productType).toBeNull();
      expect(result.reason).toBe('상품 선택이 비어있습니다');
    });

    it('should reject whitespace-only string', () => {
      const result = validateProductSelection('   ');
      expect(result.isValid).toBe(false);
      expect(result.productType).toBeNull();
      expect(result.reason).toBe('상품 선택이 비어있습니다');
    });
  });
});

describe('sheetRowToOrder', () => {
  const mockRow: SheetRow = {
    '타임스탬프': '2024. 12. 5. 오후 3:45:23',
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
    _rowNumber: 5,
  };

  describe('without config', () => {
    it('should convert SheetRow to Order with original sender data', () => {
      const order = sheetRowToOrder(mockRow);

      expect(order.timestamp).toBeInstanceOf(Date);
      expect(order.timestampRaw).toBe('2024. 12. 5. 오후 3:45:23');
      expect(order.status).toBe('');
      expect(order.productType).toBe('5kg');
      expect(order.quantity).toBe(2);
      expect(order.rowNumber).toBe(5);

      // Sender (original data)
      expect(order.sender.name).toBe('김철수');
      expect(order.sender.address).toBe('서울시 강남구 테헤란로 123');
      expect(order.sender.phone).toBe('010-1234-5678'); // formatted

      // Recipient
      expect(order.recipient.name).toBe('이영희');
      expect(order.recipient.address).toBe('서울시 송파구 올림픽로 456');
      expect(order.recipient.phone).toBe('010-9876-5432'); // formatted
    });

    it('should format phone numbers', () => {
      const order = sheetRowToOrder(mockRow);
      expect(order.sender.phone).toBe('010-1234-5678');
      expect(order.recipient.phone).toBe('010-9876-5432');
    });
  });

  describe('with config (defaultSender fallback)', () => {
    // Create a minimal mock config
    const mockConfig = {
      defaultSender: {
        name: '기본발송인',
        address: '제주도 제주시 정실3길 113',
        phone: '010-6395-0618',
      },
    } as Config;

    it('should use defaultSender when sender fields are empty', () => {
      const rowWithEmptySender: SheetRow = {
        ...mockRow,
        '보내는분 성함': '',
        '보내는분 주소 (도로명 주소로 부탁드려요)': '',
        '보내는분 연락처 (핸드폰번호)': '',
      };

      const order = sheetRowToOrder(rowWithEmptySender, mockConfig);

      expect(order.sender.name).toBe('기본발송인');
      expect(order.sender.address).toBe('제주도 제주시 정실3길 113');
      expect(order.sender.phone).toBe('010-6395-0618'); // formatted
    });

    it('should use original sender when fields are not empty', () => {
      const order = sheetRowToOrder(mockRow, mockConfig);

      expect(order.sender.name).toBe('김철수');
      expect(order.sender.address).toBe('서울시 강남구 테헤란로 123');
      expect(order.sender.phone).toBe('010-1234-5678');
    });

    it('should mix defaultSender and original data for partial fallback', () => {
      const rowWithPartialSender: SheetRow = {
        ...mockRow,
        '보내는분 성함': '박민수',
        '보내는분 주소 (도로명 주소로 부탁드려요)': '', // empty
        '보내는분 연락처 (핸드폰번호)': '01055556666',
      };

      const order = sheetRowToOrder(rowWithPartialSender, mockConfig);

      expect(order.sender.name).toBe('박민수'); // original
      expect(order.sender.address).toBe('제주도 제주시 정실3길 113'); // fallback
      expect(order.sender.phone).toBe('010-5555-6666'); // original, formatted
    });

    it('should format defaultSender phone number consistently', () => {
      const rowWithEmptyPhone: SheetRow = {
        ...mockRow,
        '보내는분 연락처 (핸드폰번호)': '',
      };

      const order = sheetRowToOrder(rowWithEmptyPhone, mockConfig);

      // defaultSender.phone should also be formatted
      expect(order.sender.phone).toBe('010-6395-0618');
      expect(order.sender.phone).toMatch(/^\d{3}-\d{4}-\d{4}$/);
    });
  });

  describe('product type detection', () => {
    it('should detect 5kg product type', () => {
      const order = sheetRowToOrder({ ...mockRow, '상품 선택': '감귤 5kg' });
      expect(order.productType).toBe('5kg');
    });

    it('should detect 10kg product type', () => {
      const order = sheetRowToOrder({ ...mockRow, '상품 선택': '감귤 10kg' });
      expect(order.productType).toBe('10kg');
    });

    it('should set validationError for unknown product type', () => {
      const order = sheetRowToOrder({ ...mockRow, '상품 선택': '감귤 3kg' });
      expect(order.validationError).toContain('유효하지 않은 상품 타입');
      expect(order.productType).toBeNull();
    });
  });
});
