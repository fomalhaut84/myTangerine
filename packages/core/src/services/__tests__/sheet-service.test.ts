/**
 * SheetService 단위 테스트
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SheetService } from '../sheet-service.js';
import { Config } from '../../config/config.js';

// Google APIs 모킹
vi.mock('googleapis', () => {
  const mockSheets = {
    spreadsheets: {
      get: vi.fn(),
      values: {
        get: vi.fn(),
        update: vi.fn(),
      },
    },
  };

  const mockDrive = {
    files: {
      list: vi.fn(),
    },
  };

  return {
    google: {
      sheets: vi.fn(() => mockSheets),
      drive: vi.fn(() => mockDrive),
      auth: {
        JWT: vi.fn().mockImplementation(function(this: any, options: any) {
          this.email = options?.email;
          this.key = options?.key;
          this.scopes = options?.scopes;
          this.setCredentials = vi.fn();
          return this;
        }),
      },
    },
  };
});

describe('SheetService', () => {
  let config: Config;
  let service: SheetService;
  let mockGoogleAPI: any;

  beforeEach(async () => {
    // Config 설정
    config = {
      defaultSender: {
        name: '기본발송인',
        address: '제주도 제주시',
        phone: '010-1234-5678',
      },
      productPrices: {
        '2024': {
          '비상품': 0,
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
        return config.productPrices[yearStr] || config.productPrices['2024'];
      },
      requiredColumns: [
        '타임스탬프',
        '비고',
        '보내는분 성함',
        '보내는분 주소 (도로명 주소로 부탁드려요)',
        '보내는분 연락처 (핸드폰번호)',
        '받으실분 성함',
        '받으실분 주소 (도로명 주소로 부탁드려요)',
        '받으실분 연락처 (핸드폰번호)',
        '상품 선택',
        '5kg 수량',
        '10kg 수량',
      ],
      spreadsheetId: 'test-sheet-id',
      spreadsheetName: 'test-sheet',
      credentialsJson: JSON.stringify({
        type: 'service_account',
        project_id: 'test',
        private_key_id: 'test',
        private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n',
        client_email: 'test@test.com',
        client_id: 'test',
        auth_uri: 'https://accounts.google.com/o/oauth2/auth',
        token_uri: 'https://oauth2.googleapis.com/token',
      }),
    } as Config;

    // googleapis 모킹
    const { google } = await import('googleapis');
    mockGoogleAPI = {
      sheets: google.sheets(),
      drive: google.drive(),
    };

    // 기본 모킹 응답 설정
    mockGoogleAPI.sheets.spreadsheets.get.mockResolvedValue({
      data: {
        sheets: [
          {
            properties: {
              title: '감귤 주문서(응답)',
            },
          },
        ],
      },
    });

    service = new SheetService(config);
  });

  describe('getAllRows', () => {
    it('should return all valid rows', async () => {
      const mockHeaders = [
        '타임스탬프',
        '비고',
        '보내는분 성함',
        '보내는분 주소 (도로명 주소로 부탁드려요)',
        '보내는분 연락처 (핸드폰번호)',
        '받으실분 성함',
        '받으실분 주소 (도로명 주소로 부탁드려요)',
        '받으실분 연락처 (핸드폰번호)',
        '상품 선택',
        '5kg 수량',
        '10kg 수량',
      ];

      const mockData = [
        mockHeaders,
        [
          '2025. 1. 21. 오전 10:30:00',
          '',
          '홍길동',
          '서울시 강남구',
          '010-1234-5678',
          '김철수',
          '서울시 송파구',
          '010-9876-5432',
          '5kg',
          '2',
          '',
        ],
        [
          '2025. 1. 21. 오후 2:15:00',
          '',
          '이영희',
          '부산시 해운대구',
          '010-2222-3333',
          '박민수',
          '부산시 연제구',
          '010-4444-5555',
          '10kg',
          '',
          '3',
        ],
      ];

      mockGoogleAPI.sheets.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: mockData,
        },
      });

      const rows = await service.getAllRows();

      expect(rows).toHaveLength(2);
      expect(rows[0]['받으실분 성함']).toBe('김철수');
      expect(rows[0]['상품 선택']).toBe('5kg');
      expect(rows[0]._rowNumber).toBe(2);
      expect(rows[1]['받으실분 성함']).toBe('박민수');
      expect(rows[1]['상품 선택']).toBe('10kg');
      expect(rows[1]._rowNumber).toBe(3);
    });

    it('should filter out rows with missing required fields', async () => {
      const mockHeaders = [
        '타임스탬프',
        '비고',
        '보내는분 성함',
        '보내는분 주소 (도로명 주소로 부탁드려요)',
        '보내는분 연락처 (핸드폰번호)',
        '받으실분 성함',
        '받으실분 주소 (도로명 주소로 부탁드려요)',
        '받으실분 연락처 (핸드폰번호)',
        '상품 선택',
        '5kg 수량',
        '10kg 수량',
      ];

      const mockData = [
        mockHeaders,
        // 유효한 행
        [
          '2025. 1. 21. 오전 10:30:00',
          '',
          '홍길동',
          '서울시 강남구',
          '010-1234-5678',
          '김철수',
          '서울시 송파구',
          '010-9876-5432',
          '5kg',
          '2',
          '',
        ],
        // 타임스탬프 누락
        [
          '',
          '',
          '이영희',
          '부산시 해운대구',
          '010-2222-3333',
          '박민수',
          '부산시 연제구',
          '010-4444-5555',
          '10kg',
          '',
          '3',
        ],
        // 받으실분 이름 누락
        [
          '2025. 1. 21. 오후 3:00:00',
          '',
          '최민호',
          '대전시 유성구',
          '010-6666-7777',
          '',
          '대전시 중구',
          '010-8888-9999',
          '5kg',
          '1',
          '',
        ],
      ];

      mockGoogleAPI.sheets.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: mockData,
        },
      });

      const rows = await service.getAllRows();

      // 유효한 행 1개만 반환되어야 함
      expect(rows).toHaveLength(1);
      expect(rows[0]['받으실분 성함']).toBe('김철수');
    });

    it('should mark rows with invalid product selection but include them', async () => {
      const mockHeaders = [
        '타임스탬프',
        '비고',
        '보내는분 성함',
        '보내는분 주소 (도로명 주소로 부탁드려요)',
        '보내는분 연락처 (핸드폰번호)',
        '받으실분 성함',
        '받으실분 주소 (도로명 주소로 부탁드려요)',
        '받으실분 연락처 (핸드폰번호)',
        '상품 선택',
        '5kg 수량',
        '10kg 수량',
      ];

      const mockData = [
        mockHeaders,
        [
          '2025. 1. 21. 오전 10:30:00',
          '',
          '홍길동',
          '서울시 강남구',
          '010-1234-5678',
          '김철수',
          '서울시 송파구',
          '010-9876-5432',
          '3kg', // 잘못된 상품
          '2',
          '',
        ],
      ];

      mockGoogleAPI.sheets.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: mockData,
        },
      });

      const rows = await service.getAllRows();

      expect(rows).toHaveLength(1);
      expect(rows[0]._validationError).toBeDefined();
      expect(rows[0]._validationError).toContain('유효하지 않은 상품 타입');
    });

    it('should return empty array when no data', async () => {
      mockGoogleAPI.sheets.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [],
        },
      });

      const rows = await service.getAllRows();

      expect(rows).toEqual([]);
    });

    it('should throw error when required columns are missing', async () => {
      const mockHeaders = ['타임스탬프', '비고']; // 필수 컬럼 누락
      const mockData = [mockHeaders];

      mockGoogleAPI.sheets.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: mockData,
        },
      });

      await expect(service.getAllRows()).rejects.toThrow('스프레드시트에 필수 컬럼이 없습니다');
    });
  });

  describe('getOrdersByStatus', () => {
    beforeEach(() => {
      const mockHeaders = [
        '타임스탬프',
        '비고',
        '보내는분 성함',
        '보내는분 주소 (도로명 주소로 부탁드려요)',
        '보내는분 연락처 (핸드폰번호)',
        '받으실분 성함',
        '받으실분 주소 (도로명 주소로 부탁드려요)',
        '받으실분 연락처 (핸드폰번호)',
        '상품 선택',
        '5kg 수량',
        '10kg 수량',
      ];

      const mockData = [
        mockHeaders,
        [
          '2025. 1. 21. 오전 10:30:00',
          '',
          '홍길동',
          '서울시 강남구',
          '010-1234-5678',
          '김철수',
          '서울시 송파구',
          '010-9876-5432',
          '5kg',
          '2',
          '',
        ],
        [
          '2025. 1. 21. 오후 2:15:00',
          '확인',
          '이영희',
          '부산시 해운대구',
          '010-2222-3333',
          '박민수',
          '부산시 연제구',
          '010-4444-5555',
          '10kg',
          '',
          '3',
        ],
        [
          '2025. 1. 21. 오후 3:00:00',
          '',
          '최민호',
          '대전시 유성구',
          '010-6666-7777',
          '정수진',
          '대전시 중구',
          '010-8888-9999',
          '5kg',
          '1',
          '',
        ],
      ];

      mockGoogleAPI.sheets.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: mockData,
        },
      });
    });

    it('should return only new orders (status=new)', async () => {
      const rows = await service.getOrdersByStatus('new');

      expect(rows).toHaveLength(2);
      expect(rows[0]['비고']).toBe('');
      expect(rows[1]['비고']).toBe('');
    });

    it('should return only completed orders (status=completed)', async () => {
      const rows = await service.getOrdersByStatus('completed');

      expect(rows).toHaveLength(1);
      expect(rows[0]['비고']).toBe('확인');
    });

    it('should return all orders (status=all)', async () => {
      const rows = await service.getOrdersByStatus('all');

      expect(rows).toHaveLength(3);
    });
  });

  describe('getOrderByRowNumber', () => {
    it('should return order for valid row number', async () => {
      const mockHeaders = [
        '타임스탬프',
        '비고',
        '보내는분 성함',
        '보내는분 주소 (도로명 주소로 부탁드려요)',
        '보내는분 연락처 (핸드폰번호)',
        '받으실분 성함',
        '받으실분 주소 (도로명 주소로 부탁드려요)',
        '받으실분 연락처 (핸드폰번호)',
        '상품 선택',
        '5kg 수량',
        '10kg 수량',
      ];

      const mockRowData = [
        '2025. 1. 21. 오전 10:30:00',
        '',
        '홍길동',
        '서울시 강남구',
        '010-1234-5678',
        '김철수',
        '서울시 송파구',
        '010-9876-5432',
        '5kg',
        '2',
        '',
      ];

      // 첫 번째 호출: 헤더 행
      mockGoogleAPI.sheets.spreadsheets.values.get
        .mockResolvedValueOnce({
          data: {
            values: [mockHeaders],
          },
        })
        // 두 번째 호출: 실제 행
        .mockResolvedValueOnce({
          data: {
            values: [mockRowData],
          },
        });

      const row = await service.getOrderByRowNumber(2);

      expect(row).not.toBeNull();
      expect(row!['받으실분 성함']).toBe('김철수');
      expect(row!._rowNumber).toBe(2);
    });

    it('should return null for non-existent row', async () => {
      const mockHeaders = [
        '타임스탬프',
        '비고',
        '보내는분 성함',
        '보내는분 주소 (도로명 주소로 부탁드려요)',
        '보내는분 연락처 (핸드폰번호)',
        '받으실분 성함',
        '받으실분 주소 (도로명 주소로 부탁드려요)',
        '받으실분 연락처 (핸드폰번호)',
        '상품 선택',
        '5kg 수량',
        '10kg 수량',
      ];

      mockGoogleAPI.sheets.spreadsheets.values.get
        .mockResolvedValueOnce({
          data: {
            values: [mockHeaders],
          },
        })
        .mockResolvedValueOnce({
          data: {
            values: undefined,
          },
        });

      const row = await service.getOrderByRowNumber(999);

      expect(row).toBeNull();
    });

    it('should return null for row with missing required fields', async () => {
      const mockHeaders = [
        '타임스탬프',
        '비고',
        '보내는분 성함',
        '보내는분 주소 (도로명 주소로 부탁드려요)',
        '보내는분 연락처 (핸드폰번호)',
        '받으실분 성함',
        '받으실분 주소 (도로명 주소로 부탁드려요)',
        '받으실분 연락처 (핸드폰번호)',
        '상품 선택',
        '5kg 수량',
        '10kg 수량',
      ];

      const mockRowData = [
        '',  // 타임스탬프 누락
        '',
        '홍길동',
        '서울시 강남구',
        '010-1234-5678',
        '김철수',
        '서울시 송파구',
        '010-9876-5432',
        '5kg',
        '2',
        '',
      ];

      mockGoogleAPI.sheets.spreadsheets.values.get
        .mockResolvedValueOnce({
          data: {
            values: [mockHeaders],
          },
        })
        .mockResolvedValueOnce({
          data: {
            values: [mockRowData],
          },
        });

      const row = await service.getOrderByRowNumber(2);

      expect(row).toBeNull();
    });

    it('should cache headers to reduce API calls', async () => {
      const mockHeaders = [
        '타임스탬프',
        '비고',
        '보내는분 성함',
        '보내는분 주소 (도로명 주소로 부탁드려요)',
        '보내는분 연락처 (핸드폰번호)',
        '받으실분 성함',
        '받으실분 주소 (도로명 주소로 부탁드려요)',
        '받으실분 연락처 (핸드폰번호)',
        '상품 선택',
        '5kg 수량',
        '10kg 수량',
      ];

      const mockRowData1 = [
        '2025. 1. 21. 오전 10:30:00',
        '',
        '홍길동',
        '서울시 강남구',
        '010-1234-5678',
        '김철수',
        '서울시 송파구',
        '010-9876-5432',
        '5kg',
        '2',
        '',
      ];

      const mockRowData2 = [
        '2025. 1. 21. 오후 2:15:00',
        '',
        '이영희',
        '부산시 해운대구',
        '010-2222-3333',
        '박민수',
        '부산시 연제구',
        '010-4444-5555',
        '10kg',
        '',
        '3',
      ];

      // 이 테스트 전 호출 횟수 저장
      const callCountBefore = mockGoogleAPI.sheets.spreadsheets.values.get.mock.calls.length;

      // 첫 번째 getOrderByRowNumber 호출
      mockGoogleAPI.sheets.spreadsheets.values.get
        .mockResolvedValueOnce({
          data: {
            values: [mockHeaders],
          },
        })
        .mockResolvedValueOnce({
          data: {
            values: [mockRowData1],
          },
        })
        // 두 번째 getOrderByRowNumber 호출 - 헤더는 캐시에서 가져오므로 행만 가져옴
        .mockResolvedValueOnce({
          data: {
            values: [mockRowData2],
          },
        });

      // 첫 번째 호출 (헤더 + 행)
      const row1 = await service.getOrderByRowNumber(2);
      expect(row1).not.toBeNull();
      expect(row1!['받으실분 성함']).toBe('김철수');

      // 두 번째 호출 (행만)
      const row2 = await service.getOrderByRowNumber(3);
      expect(row2).not.toBeNull();
      expect(row2!['받으실분 성함']).toBe('박민수');

      // API 호출 횟수 검증
      const callCountAfter = mockGoogleAPI.sheets.spreadsheets.values.get.mock.calls.length;
      const additionalCalls = callCountAfter - callCountBefore;

      // 첫 번째: 헤더 (1회) + 행 (1회) = 2회
      // 두 번째: 행만 (1회) = 1회
      // 총 3회 추가 호출되어야 함 (헤더 캐싱 없이는 4회가 됨)
      expect(additionalCalls).toBe(3);
    });

    it('should throw error when headers validation fails', async () => {
      const mockHeaders = ['타임스탬프', '비고']; // 필수 컬럼 누락

      mockGoogleAPI.sheets.spreadsheets.values.get
        .mockResolvedValueOnce({
          data: {
            values: [mockHeaders],
          },
        });

      await expect(service.getOrderByRowNumber(2)).rejects.toThrow('스프레드시트에 필수 컬럼이 없습니다');
    });
  });

  describe('updateCell', () => {
    it('should convert column numbers to A1 notation correctly (A-Z)', async () => {
      mockGoogleAPI.sheets.spreadsheets.values.update.mockResolvedValue({});

      // 1 -> A
      await service.updateCell(10, 1, 'test1');
      expect(mockGoogleAPI.sheets.spreadsheets.values.update).toHaveBeenCalledWith(
        expect.objectContaining({
          range: "'감귤 주문서(응답)'!A10",
        })
      );

      // 26 -> Z
      await service.updateCell(10, 26, 'test26');
      expect(mockGoogleAPI.sheets.spreadsheets.values.update).toHaveBeenCalledWith(
        expect.objectContaining({
          range: "'감귤 주문서(응답)'!Z10",
        })
      );
    });

    it('should convert column numbers to A1 notation correctly (AA and beyond)', async () => {
      mockGoogleAPI.sheets.spreadsheets.values.update.mockResolvedValue({});

      // 27 -> AA
      await service.updateCell(10, 27, 'test27');
      expect(mockGoogleAPI.sheets.spreadsheets.values.update).toHaveBeenCalledWith(
        expect.objectContaining({
          range: "'감귤 주문서(응답)'!AA10",
        })
      );

      // 28 -> AB
      await service.updateCell(10, 28, 'test28');
      expect(mockGoogleAPI.sheets.spreadsheets.values.update).toHaveBeenCalledWith(
        expect.objectContaining({
          range: "'감귤 주문서(응답)'!AB10",
        })
      );

      // 52 -> AZ
      await service.updateCell(10, 52, 'test52');
      expect(mockGoogleAPI.sheets.spreadsheets.values.update).toHaveBeenCalledWith(
        expect.objectContaining({
          range: "'감귤 주문서(응답)'!AZ10",
        })
      );

      // 53 -> BA
      await service.updateCell(10, 53, 'test53');
      expect(mockGoogleAPI.sheets.spreadsheets.values.update).toHaveBeenCalledWith(
        expect.objectContaining({
          range: "'감귤 주문서(응답)'!BA10",
        })
      );

      // 702 -> ZZ
      await service.updateCell(10, 702, 'test702');
      expect(mockGoogleAPI.sheets.spreadsheets.values.update).toHaveBeenCalledWith(
        expect.objectContaining({
          range: "'감귤 주문서(응답)'!ZZ10",
        })
      );

      // 703 -> AAA
      await service.updateCell(10, 703, 'test703');
      expect(mockGoogleAPI.sheets.spreadsheets.values.update).toHaveBeenCalledWith(
        expect.objectContaining({
          range: "'감귤 주문서(응답)'!AAA10",
        })
      );
    });

    it('should throw error for invalid column numbers', async () => {
      // col = 0
      await expect(service.updateCell(10, 0, 'test')).rejects.toThrow('Invalid column number: 0');

      // col < 0
      await expect(service.updateCell(10, -1, 'test')).rejects.toThrow('Invalid column number: -1');
    });
  });
});
