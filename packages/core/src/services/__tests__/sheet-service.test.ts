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
        batchUpdate: vi.fn(),
        batchGet: vi.fn(),
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

  // #264: 처리 대상과 행 밀림 판정 색인을 같은 응답 하나에서
  describe('getAllRowsSnapshot', () => {
    const headers = ['타임스탬프', '비고', '보내는분 성함', '보내는분 주소 (도로명 주소로 부탁드려요)', '보내는분 연락처 (핸드폰번호)',
      '받으실분 성함', '받으실분 주소 (도로명 주소로 부탁드려요)', '받으실분 연락처 (핸드폰번호)', '상품 선택', '5kg 수량', '10kg 수량', '삭제됨'];
    const full = (ts: string, deleted = '') => [ts, '', 'a', 'b', '010', '받는이', '주소', '010-1', '5kg', '1', '', deleted];

    it('rows 는 getAllRows 처럼 거르고 physical 은 같은 응답의 물리 행 전체(삭제됨 · 필수 정보 빠진 행 포함)', async () => {
      const get = mockGoogleAPI.sheets.spreadsheets.values.get;
      get.mockReset();
      get.mockResolvedValueOnce({
        data: {
          values: [
            headers,
            full('2026. 11. 19 오전 10:26:32'),
            full('2026. 1. 7 오후 7:49:40', '2026-11-19'), // 삭제됨
            ['2026. 1. 8 오전 9:00:00', ''], // 받는 사람 정보 없음
          ],
        },
      });
      const { rows, physical } = await service.getAllRowsSnapshot();
      expect(get).toHaveBeenCalledTimes(1);
      expect(rows.map((r) => r._rowNumber)).toEqual([2]);
      expect(physical).toEqual([
        { _rowNumber: 2, 타임스탬프: '2026. 11. 19 오전 10:26:32' },
        { _rowNumber: 3, 타임스탬프: '2026. 1. 7 오후 7:49:40' },
        { _rowNumber: 4, 타임스탬프: '2026. 1. 8 오전 9:00:00' },
      ]);
    });
  });

  // #258: hybrid 쓰기 전 행 확인 — 타임스탬프 칸만 한 번에 읽는다
  describe('getTimestampsByRows', () => {
    const headers = ['비고', '타임스탬프', '보내는분 성함', '보내는분 주소 (도로명 주소로 부탁드려요)', '보내는분 연락처 (핸드폰번호)',
      '받으실분 성함', '받으실분 주소 (도로명 주소로 부탁드려요)', '받으실분 연락처 (핸드폰번호)', '상품 선택', '5kg 수량', '10kg 수량'];

    it('헤더에서 타임스탬프 열을 찾아(A 열이라고 가정하지 않음) 연속 범위 하나를 1회로 읽는다 · 빈 칸은 빈 문자열', async () => {
      const get = mockGoogleAPI.sheets.spreadsheets.values.get;
      get.mockReset();
      get
        .mockResolvedValueOnce({ data: { values: [headers] } }) // 헤더
        .mockResolvedValueOnce({ data: { values: [['2026. 11. 19 오전 10:26:32'], [], ['2026. 1. 7 오후 7:49:40']] } });

      const result = await service.getTimestampsByRows([393, 391, 392]);

      expect(get).toHaveBeenCalledTimes(2);
      expect(get).toHaveBeenLastCalledWith(expect.objectContaining({ range: "'감귤 주문서(응답)'!B391:B393" }));
      expect(result).toEqual(
        new Map([
          [393, '2026. 1. 7 오후 7:49:40'],
          [391, '2026. 11. 19 오전 10:26:32'],
          [392, ''],
        ])
      );
    });

    it('범위 끝이 시트보다 짧게 오면(뒤쪽 빈 행) 빈 문자열', async () => {
      const get = mockGoogleAPI.sheets.spreadsheets.values.get;
      get.mockReset();
      get.mockResolvedValueOnce({ data: { values: [headers] } }).mockResolvedValueOnce({ data: { values: [['x']] } });
      expect(await service.getTimestampsByRows([10, 12])).toEqual(new Map([[10, 'x'], [12, '']]));
    });

    it('빈 목록이면 읽지 않는다', async () => {
      const get = mockGoogleAPI.sheets.spreadsheets.values.get;
      get.mockReset();
      expect(await service.getTimestampsByRows([])).toEqual(new Map());
      expect(get).not.toHaveBeenCalled();
    });

    it('읽기 실패는 행 번호를 담아 던진다', async () => {
      const get = mockGoogleAPI.sheets.spreadsheets.values.get;
      get.mockReset();
      get.mockResolvedValueOnce({ data: { values: [headers] } }).mockRejectedValueOnce(new Error('quota'));
      await expect(service.getTimestampsByRows([391])).rejects.toThrow('Failed to read timestamps for rows 391: quota');
    });
  });

  // #261: 동기화 상태 칸을 여러 행 한 번에 쓴다
  describe('updateRowsCells', () => {
    const headers = ['비고', '타임스탬프', '보내는분 성함', '보내는분 주소 (도로명 주소로 부탁드려요)', '보내는분 연락처 (핸드폰번호)',
      '받으실분 성함', '받으실분 주소 (도로명 주소로 부탁드려요)', '받으실분 연락처 (핸드폰번호)', '상품 선택', '5kg 수량', '10kg 수량',
      'DB_SYNC_STATUS', 'DB_SYNC_AT', 'DB_SYNC_ID'];

    it('여러 행의 칸을 batchUpdate 1회로 쓴다 · 헤더에서 열을 찾는다', async () => {
      const get = mockGoogleAPI.sheets.spreadsheets.values.get;
      const batchUpdate = mockGoogleAPI.sheets.spreadsheets.values.batchUpdate;
      get.mockReset();
      batchUpdate.mockReset();
      get.mockResolvedValueOnce({ data: { values: [headers] } });
      batchUpdate.mockResolvedValue({});

      await service.updateRowsCells([
        { row: 10, updates: { DB_SYNC_STATUS: 'success', DB_SYNC_ID: '5' } },
        { row: 12, updates: { DB_SYNC_STATUS: 'fail' } },
      ]);

      expect(batchUpdate).toHaveBeenCalledTimes(1);
      expect(batchUpdate.mock.calls[0][0].requestBody).toEqual({
        valueInputOption: 'RAW',
        data: [
          { range: "'감귤 주문서(응답)'!L10", values: [['success']] },
          { range: "'감귤 주문서(응답)'!N10", values: [['5']] },
          { range: "'감귤 주문서(응답)'!L12", values: [['fail']] },
        ],
      });
    });

    it('빈 목록이면 쓰지 않는다', async () => {
      const batchUpdate = mockGoogleAPI.sheets.spreadsheets.values.batchUpdate;
      batchUpdate.mockReset();
      await service.updateRowsCells([]);
      expect(batchUpdate).not.toHaveBeenCalled();
    });

    it('없는 열이면 아무것도 쓰지 않고 던진다', async () => {
      const get = mockGoogleAPI.sheets.spreadsheets.values.get;
      const batchUpdate = mockGoogleAPI.sheets.spreadsheets.values.batchUpdate;
      get.mockReset();
      batchUpdate.mockReset();
      get.mockResolvedValueOnce({ data: { values: [headers] } });
      await expect(service.updateRowsCells([{ row: 10, updates: { 없는열: 'x' } }])).rejects.toThrow("Column '없는열' not found");
      expect(batchUpdate).not.toHaveBeenCalled();
    });
  });

  // #231: 재조정 — 헤더(1행)와 대상 행들을 한 요청으로 새로 읽는다(헤더 캐시가 낡아 엉뚱한 열에 쓰지 않게)
  describe('getRowsWithHeaders', () => {
    const headers = ['비고', '타임스탬프', '보내는분 성함', '보내는분 주소 (도로명 주소로 부탁드려요)', '보내는분 연락처 (핸드폰번호)',
      '받으실분 성함', '받으실분 주소 (도로명 주소로 부탁드려요)', '받으실분 연락처 (핸드폰번호)', '상품 선택', '5kg 수량', '10kg 수량'];

    it('batchGet 1회로 헤더 + 연속 범위를 읽어 행 번호 → {헤더: 값} · 빈 칸은 빈 문자열 · 헤더 캐시를 갱신한다', async () => {
      const batchGet = mockGoogleAPI.sheets.spreadsheets.values.batchGet;
      batchGet.mockReset();
      batchGet.mockResolvedValueOnce({
        data: { valueRanges: [{ values: [headers] }, { values: [['입금확인', 'T391'], [], ['', 'T393', '보내는이']] }] },
      });

      const { headers: h, rows } = await service.getRowsWithHeaders([393, 391]);

      expect(batchGet).toHaveBeenCalledTimes(1);
      expect(batchGet.mock.calls[0][0].ranges).toEqual(["'감귤 주문서(응답)'!1:1", "'감귤 주문서(응답)'!391:393"]);
      expect(h).toEqual(headers);
      expect(rows.get(391)).toMatchObject({ 비고: '입금확인', 타임스탬프: 'T391', '상품 선택': '' });
      expect(rows.get(393)).toMatchObject({ 비고: '', 타임스탬프: 'T393', '보내는분 성함': '보내는이' });
      expect(rows.has(392)).toBe(false);
    });

    it('필수 열이 없는 헤더면 던진다', async () => {
      const batchGet = mockGoogleAPI.sheets.spreadsheets.values.batchGet;
      batchGet.mockReset();
      batchGet.mockResolvedValueOnce({ data: { valueRanges: [{ values: [['타임스탬프']] }, { values: [] }] } });
      await expect(service.getRowsWithHeaders([5])).rejects.toThrow();
    });
  });
});
