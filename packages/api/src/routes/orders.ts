/**
 * 주문 관련 API 라우트
 */

import { FastifyPluginAsync } from 'fastify';
import { sheetRowToOrder, mapOrdersToPdfRows } from '@mytangerine/core';
import {
  calculateStats,
  calculateOrderAmount,
  type StatsScope,
  type StatsRange,
  type StatsGrouping,
  type StatsMetric,
  type StatsResponse,
  type OrderTypeFilter,
} from '../utils/stats.js';
import { InMemoryCache } from '../utils/cache.js';
import { generatePdfBuffer } from '../utils/pdf-generator.js';

/**
 * 통계 데이터를 CSV 형식으로 변환
 */
function convertStatsToCSV(stats: StatsResponse): string {
  const headers = [
    'period',
    'totalNonProductQty',
    'total5kgQty',
    'total10kgQty',
    'totalNonProductAmount',
    'total5kgAmount',
    'total10kgAmount',
    'orderCount',
    'avgOrderAmount',
    'momGrowthPct',
  ];

  const rows = stats.series.map((item) => [
    item.period,
    item.totalNonProductQty.toString(),
    item.total5kgQty.toString(),
    item.total10kgQty.toString(),
    item.totalNonProductAmount.toString(),
    item.total5kgAmount.toString(),
    item.total10kgAmount.toString(),
    item.orderCount.toString(),
    item.avgOrderAmount.toString(),
    item.momGrowthPct !== null ? item.momGrowthPct.toString() : '',
  ]);

  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

// 통계 캐시 (TTL: 10분)
const statsCache = new InMemoryCache<StatsResponse>();
const STATS_CACHE_TTL = 10 * 60 * 1000; // 10분

/**
 * 통계 캐시 키 생성
 */
function getStatsCacheKey(
  scope: StatsScope,
  range: StatsRange,
  grouping: StatsGrouping,
  metric: StatsMetric,
  orderType: OrderTypeFilter,
  customStart?: Date,
  customEnd?: Date
): string {
  const start = customStart ? customStart.toISOString().split('T')[0] : '';
  const end = customEnd ? customEnd.toISOString().split('T')[0] : '';
  return `stats:${scope}:${range}:${grouping}:${metric}:${orderType}:${start}:${end}`;
}

/**
 * 통계 캐시 클리어 (테스트용)
 */
export function clearStatsCache(): void {
  statsCache.clear();
}

/**
 * PDF 리포트 생성 파라미터 타입
 */
interface PdfReportParams {
  rowNumbers?: number[];
  status?: string;
  from?: string;
  to?: string;
  sort?: 'timestamp' | 'status';
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

/**
 * PDF 리포트용 주문 데이터 처리 (GET/POST 공통 로직)
 * Issue #104: 코드 중복 제거
 */
function processOrdersForPdfReport(
  orders: ReturnType<typeof sheetRowToOrder>[],
  params: PdfReportParams
): { orders: ReturnType<typeof sheetRowToOrder>[]; filterDescription?: string } {
  const { rowNumbers, status, from, to, sort, order, limit, offset } = params;

  let filteredOrders = orders;

  // rowNumbers 파라미터가 있으면 해당 행만 선택
  if (rowNumbers && rowNumbers.length > 0) {
    // rowNumber로 필터링
    const rowNumbersSet = new Set(rowNumbers);
    filteredOrders = filteredOrders.filter((order) => rowNumbersSet.has(order.rowNumber ?? -1));

    // O(n) 성능을 위해 Map으로 인덱스 조회 (P2 수정)
    const rowNumberIndexMap = new Map(rowNumbers.map((num, index) => [num, index]));

    // 사용자가 지정한 순서대로 정렬
    filteredOrders.sort((a, b) => {
      const aIndex = rowNumberIndexMap.get(a.rowNumber!) ?? Number.MAX_SAFE_INTEGER;
      const bIndex = rowNumberIndexMap.get(b.rowNumber!) ?? Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex;
    });
  } else {
    // rowNumbers가 없으면 기존 로직 사용
    // 필터링: status
    if (status) {
      filteredOrders = filteredOrders.filter((order) => order.status === status);
    }

    // 필터링: from/to (날짜 범위)
    if (from || to) {
      const fromDate = from ? new Date(from) : new Date(0);
      const toDate = to ? new Date(to) : new Date();
      toDate.setHours(23, 59, 59, 999); // 종료일 포함

      filteredOrders = filteredOrders.filter((order) => {
        const orderDate = new Date(order.timestamp);
        return orderDate >= fromDate && orderDate <= toDate;
      });
    }

    // 정렬
    const sortField = sort || 'timestamp';
    const sortOrder = order || 'desc';

    filteredOrders.sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;

      if (sortField === 'timestamp') {
        aVal = new Date(a.timestamp).getTime();
        bVal = new Date(b.timestamp).getTime();
      } else if (sortField === 'status') {
        aVal = a.status;
        bVal = b.status;
      } else {
        aVal = 0;
        bVal = 0;
      }

      if (sortOrder === 'asc') {
        return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
      } else {
        return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
      }
    });

    // 페이지네이션
    const limitVal = limit || 100;
    const offsetVal = offset || 0;
    filteredOrders = filteredOrders.slice(offsetVal, offsetVal + limitVal);
  }

  // 필터 설명 생성
  const filterParts: string[] = [];
  if (status) filterParts.push(`상태: ${status}`);
  if (from) filterParts.push(`시작: ${from}`);
  if (to) filterParts.push(`종료: ${to}`);
  const filterDescription =
    filterParts.length > 0 ? `필터: ${filterParts.join(', ')}` : undefined;

  return { orders: filteredOrders, filterDescription };
}

/**
 * 주문 라우트
 */
const ordersRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/orders
   * 주문 조회 (상태별 필터링 지원)
   */
  fastify.get<{
    Querystring: { status?: 'new' | 'completed' | 'all' };
  }>(
    '/api/orders',
    {
      schema: {
        tags: ['orders'],
        summary: '주문 목록 조회',
        description: 'Status별로 주문들을 조회합니다. 기본값은 새로운 주문(비고 != "확인")입니다.',
        querystring: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['new', 'completed', 'all'],
              description: '주문 상태 필터 (new: 신규, completed: 완료, all: 전체)',
              default: 'new',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['success', 'count', 'orders'],
            properties: {
              success: { type: 'boolean', enum: [true], example: true },
              count: { type: 'integer', minimum: 0, description: '주문 개수', example: 5 },
              orders: {
                type: 'array',
                items: { $ref: 'Order#' },
              },
            },
          },
          500: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request) => {
    const { sheetService, config } = fastify.core;
    const status = request.query.status || 'new';

    // Status별 주문 가져오기
    const sheetRows = await sheetService.getOrdersByStatus(status);

    // SheetRow를 Order로 변환
    const orders = sheetRows.map((row) => sheetRowToOrder(row, config));

    return {
      success: true,
      count: orders.length,
      orders: orders.map((order) => ({
        timestamp: order.timestamp.toISOString(),
        timestampRaw: order.timestampRaw,
        status: order.status,
        sender: order.sender,
        recipient: order.recipient,
        productType: order.productType,
        quantity: order.quantity,
        rowNumber: order.rowNumber,
        validationError: order.validationError,
      })),
    };
  });

  /**
   * GET /api/orders/summary
   * 주문 요약 정보
   */
  fastify.get(
    '/api/orders/summary',
    {
      schema: {
        tags: ['orders'],
        summary: '주문 요약 정보 조회',
        description: '5kg, 10kg별 수량과 금액, 총 금액을 계산합니다.',
        response: {
          200: {
            type: 'object',
            required: ['success', 'summary'],
            properties: {
              success: { type: 'boolean', enum: [true], example: true },
              summary: { $ref: 'OrderSummary#' },
            },
          },
          500: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async () => {
    const { sheetService, config } = fastify.core;

    // 새로운 주문 가져오기
    const sheetRows = await sheetService.getNewOrders();

    // SheetRow를 Order로 변환
    const orders = sheetRows.map((row) => sheetRowToOrder(row, config));

    // 5kg, 10kg 수량 및 금액 집계
    let total5kg = 0;
    let total10kg = 0;
    let price5kg = 0;
    let price10kg = 0;

    orders.forEach((order) => {
      const amount = calculateOrderAmount(order, config);
      if (order.productType === '5kg') {
        total5kg += order.quantity;
        price5kg += amount;
      } else if (order.productType === '10kg') {
        total10kg += order.quantity;
        price10kg += amount;
      }
    });

    const totalPrice = price5kg + price10kg;

    return {
      success: true,
      summary: {
        '5kg': {
          count: total5kg,
          amount: price5kg,
        },
        '10kg': {
          count: total10kg,
          amount: price10kg,
        },
        total: totalPrice,
      },
    };
  });

  /**
   * POST /api/orders/confirm
   * 모든 새 주문을 "확인" 상태로 표시
   */
  fastify.post(
    '/api/orders/confirm',
    {
      schema: {
        tags: ['orders'],
        summary: '주문 확인 처리',
        description: '모든 새로운 주문을 "확인" 상태로 표시합니다.',
        response: {
          200: {
            type: 'object',
            required: ['success', 'message', 'confirmedCount'],
            properties: {
              success: { type: 'boolean', enum: [true], example: true },
              message: { type: 'string', description: '확인 메시지', example: '5개의 주문이 확인되었습니다.' },
              confirmedCount: {
                type: 'integer',
                minimum: 0,
                description: '확인된 주문 개수',
                example: 5,
              },
            },
          },
          500: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async () => {
    const { sheetService } = fastify.core;

    // 먼저 새로운 주문을 가져오기
    const newOrders = await sheetService.getNewOrders();

    if (newOrders.length === 0) {
      return {
        success: true,
        message: '확인할 새로운 주문이 없습니다.',
        confirmedCount: 0,
      };
    }

    // 확인할 행 번호를 명시적으로 추출 (race condition 방지)
    const rowNumbers = newOrders
      .map((order) => order._rowNumber)
      .filter((n): n is number => n !== undefined && n > 0);

    // 주문을 확인 상태로 표시 (명시적으로 행 번호 전달)
    await sheetService.markAsConfirmed(rowNumbers);

    // 통계 캐시 무효화 (새 주문이 완료됨으로 변경되었으므로)
    statsCache.invalidate(/^stats:/);

    return {
      success: true,
      message: `${newOrders.length}개의 주문이 확인되었습니다.`,
      confirmedCount: newOrders.length,
    };
  });

  /**
   * GET /api/orders/report
   * 주문 목록 PDF 내보내기
   * Issue #98: 주문 목록 PDF 내보내기
   */
  fastify.get(
    '/api/orders/report',
    {
      schema: {
        tags: ['orders'],
        summary: 'PDF 형식으로 주문 목록 다운로드',
        description: '필터링된 주문 목록을 PDF 파일로 생성하여 다운로드합니다.',
        querystring: {
          type: 'object',
          properties: {
            rowNumbers: {
              type: 'string',
              description: '선택된 행 번호들 (쉼표로 구분, 예: "2,3,5")',
            },
            status: {
              type: 'string',
              description: '주문 상태 필터 (예: 확인, 미확인)',
            },
            from: {
              type: 'string',
              format: 'date',
              description: '시작 날짜 (YYYY-MM-DD)',
            },
            to: {
              type: 'string',
              format: 'date',
              description: '종료 날짜 (YYYY-MM-DD)',
            },
            sort: {
              type: 'string',
              enum: ['timestamp', 'status'],
              default: 'timestamp',
              description: '정렬 기준',
            },
            order: {
              type: 'string',
              enum: ['asc', 'desc'],
              default: 'desc',
              description: '정렬 순서',
            },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 1000,
              default: 100,
              description: '최대 결과 수',
            },
            offset: {
              type: 'integer',
              minimum: 0,
              default: 0,
              description: '건너뛸 결과 수',
            },
          },
        },
        response: {
          200: {
            type: 'string',
            description: 'PDF 파일 (application/pdf)',
          },
          500: {
            type: 'object',
            properties: {
              error: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { rowNumbers: rowNumbersStr, status, from, to, sort, order, limit, offset } = request.query as {
        rowNumbers?: string;
        status?: string;
        from?: string;
        to?: string;
        sort?: 'timestamp' | 'status';
        order?: 'asc' | 'desc';
        limit?: number;
        offset?: number;
      };

      try {
        // rowNumbers 문자열 파싱 및 검증
        let rowNumbers: number[] | undefined;
        if (rowNumbersStr) {
          const tokens = rowNumbersStr.split(',').map((n) => n.trim());

          // 검증: 각 토큰이 정수인지 확인 (정규식으로 엄격하게 검증)
          const isValidInteger = /^\d+$/;
          const invalidTokens = tokens.filter((token) => !isValidInteger.test(token));

          if (invalidTokens.length > 0) {
            return reply.code(400).send({
              error: 'Invalid row numbers',
              message: `rowNumbers must be comma-separated positive integers. Invalid: ${invalidTokens.join(', ')}`,
            });
          }

          rowNumbers = tokens.map((n) => parseInt(n, 10));

          // 검증: 1000건 제한
          if (rowNumbers.length > 1000) {
            return reply.code(400).send({
              error: 'Too many rows',
              message: 'Cannot select more than 1000 rows at once',
            });
          }
        }

        // SheetService에서 모든 주문 가져오기
        const allRows = await fastify.core.sheetService.getAllRows();
        const allOrders = allRows.map((row) => sheetRowToOrder(row, fastify.core.config));

        // 공통 헬퍼 함수로 주문 처리
        const { orders: paginatedOrders, filterDescription } = processOrdersForPdfReport(
          allOrders,
          { rowNumbers, status, from, to, sort, order, limit, offset }
        );

        // PDF 데이터 변환 및 생성
        const pdfRows = mapOrdersToPdfRows(paginatedOrders);
        const pdfBuffer = await generatePdfBuffer(pdfRows, {
          title: '현애순(딸) 주문목록',
          includeTimestamp: true,
          filterDescription,
          pageOrientation: 'landscape',
          pageSize: 'A4',
        });

        // 파일명 생성 (YYYYMMDD 형식)
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
        const filename = `orders-report-${dateStr}.pdf`;

        // 응답 헤더 설정
        reply.header('Content-Type', 'application/pdf');
        reply.header('Content-Disposition', `attachment; filename="${filename}"`);
        reply.header('X-Order-Count', paginatedOrders.length.toString());
        reply.header('X-Generated-At', now.toISOString());

        return reply.send(pdfBuffer);
      } catch (error) {
        fastify.log.error(error, 'PDF 생성 중 오류 발생');
        return reply.status(500).send({
          error: 'PDF_GENERATION_ERROR',
          message: error instanceof Error ? error.message : 'PDF 생성 실패',
        });
      }
    }
  );

  /**
   * POST /api/orders/report
   * 주문 목록 PDF 내보내기 (POST 버전)
   * Issue #104: 모바일 환경 대응 - URL 길이 제한 우회
   */
  fastify.post(
    '/api/orders/report',
    {
      schema: {
        tags: ['orders'],
        summary: 'PDF 형식으로 주문 목록 다운로드 (POST)',
        description:
          '필터링된 주문 목록을 PDF 파일로 생성하여 다운로드합니다. ' +
          'rowNumbers를 body로 전송하여 URL 길이 제한을 우회합니다.',
        body: {
          type: 'object',
          properties: {
            rowNumbers: {
              type: 'array',
              items: { type: 'integer' },
              description: '선택된 행 번호 배열 (예: [2, 3, 5])',
            },
            status: {
              type: 'string',
              description: '주문 상태 필터 (예: 확인, 미확인)',
            },
            from: {
              type: 'string',
              format: 'date',
              description: '시작 날짜 (YYYY-MM-DD)',
            },
            to: {
              type: 'string',
              format: 'date',
              description: '종료 날짜 (YYYY-MM-DD)',
            },
            sort: {
              type: 'string',
              enum: ['timestamp', 'status'],
              default: 'timestamp',
              description: '정렬 기준',
            },
            order: {
              type: 'string',
              enum: ['asc', 'desc'],
              default: 'desc',
              description: '정렬 순서',
            },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 1000,
              default: 100,
              description: '최대 결과 수',
            },
            offset: {
              type: 'integer',
              minimum: 0,
              default: 0,
              description: '건너뛸 결과 수',
            },
          },
        },
        response: {
          200: {
            type: 'string',
            description: 'PDF 파일 (application/pdf)',
          },
          500: {
            type: 'object',
            properties: {
              error: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { rowNumbers, status, from, to, sort, order, limit, offset } = request.body as {
        rowNumbers?: number[];
        status?: string;
        from?: string;
        to?: string;
        sort?: 'timestamp' | 'status';
        order?: 'asc' | 'desc';
        limit?: number;
        offset?: number;
      };

      try {
        // 검증: 1000건 제한
        if (rowNumbers && rowNumbers.length > 1000) {
          return reply.code(400).send({
            error: 'Too many rows',
            message: 'Cannot select more than 1000 rows at once',
          });
        }

        // SheetService에서 모든 주문 가져오기
        const allRows = await fastify.core.sheetService.getAllRows();
        const allOrders = allRows.map((row) => sheetRowToOrder(row, fastify.core.config));

        // 공통 헬퍼 함수로 주문 처리
        const { orders: paginatedOrders, filterDescription } = processOrdersForPdfReport(
          allOrders,
          { rowNumbers, status, from, to, sort, order, limit, offset }
        );

        // PDF 데이터 변환 및 생성
        const pdfRows = mapOrdersToPdfRows(paginatedOrders);
        const pdfBuffer = await generatePdfBuffer(pdfRows, {
          title: '현애순(딸) 주문목록',
          includeTimestamp: true,
          filterDescription,
          pageOrientation: 'landscape',
          pageSize: 'A4',
        });

        // 파일명 생성 (YYYYMMDD 형식)
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
        const filename = `orders-report-${dateStr}.pdf`;

        // 응답 헤더 설정
        reply.header('Content-Type', 'application/pdf');
        reply.header('Content-Disposition', `attachment; filename="${filename}"`);
        reply.header('X-Order-Count', paginatedOrders.length.toString());
        reply.header('X-Generated-At', now.toISOString());

        return reply.send(pdfBuffer);
      } catch (error) {
        fastify.log.error(error, 'PDF 생성 중 오류 발생');
        return reply.status(500).send({
          error: 'PDF_GENERATION_ERROR',
          message: error instanceof Error ? error.message : 'PDF 생성 실패',
        });
      }
    }
  );

  /**
   * GET /api/orders/:rowNumber
   * 특정 주문 조회
   */
  fastify.get<{
    Params: { rowNumber: string };
  }>(
    '/api/orders/:rowNumber',
    {
      schema: {
        tags: ['orders'],
        summary: '특정 주문 조회',
        description: '행 번호로 특정 주문을 조회합니다.',
        params: {
          type: 'object',
          required: ['rowNumber'],
          properties: {
            rowNumber: {
              type: 'string',
              description: '스프레드시트 행 번호',
              example: '5',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['success', 'order'],
            properties: {
              success: { type: 'boolean', enum: [true], example: true },
              order: { $ref: 'Order#' },
            },
          },
          400: { $ref: 'ErrorResponse#' },
          404: { $ref: 'ErrorResponse#' },
          500: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request, reply) => {
      const { sheetService, config } = fastify.core;

      // 엄격한 숫자 검증: "2foo" 같은 값을 거부
      const rowNumber = Number(request.params.rowNumber);

      if (!Number.isInteger(rowNumber) || rowNumber < 2) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid row number. Row number must be a positive integer greater than 1.',
          statusCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      // 특정 주문 조회
      const sheetRow = await sheetService.getOrderByRowNumber(rowNumber);

      if (!sheetRow) {
        return reply.code(404).send({
          success: false,
          error: `Order not found at row ${rowNumber}`,
          statusCode: 404,
          timestamp: new Date().toISOString(),
        });
      }

      // SheetRow를 Order로 변환
      const order = sheetRowToOrder(sheetRow, config);

      return {
        success: true,
        order: {
          timestamp: order.timestamp.toISOString(),
          timestampRaw: order.timestampRaw,
          status: order.status,
          sender: order.sender,
          recipient: order.recipient,
          productType: order.productType,
          quantity: order.quantity,
          rowNumber: order.rowNumber,
          validationError: order.validationError,
        },
      };
    }
  );

  /**
   * POST /api/orders/:rowNumber/confirm
   * 특정 주문을 "확인" 상태로 표시
   */
  fastify.post<{
    Params: { rowNumber: string };
  }>(
    '/api/orders/:rowNumber/confirm',
    {
      schema: {
        tags: ['orders'],
        summary: '개별 주문 확인 처리',
        description: '특정 주문을 "확인" 상태로 표시합니다.',
        params: {
          type: 'object',
          required: ['rowNumber'],
          properties: {
            rowNumber: {
              type: 'string',
              description: '스프레드시트 행 번호',
              example: '5',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['success', 'message'],
            properties: {
              success: { type: 'boolean', enum: [true], example: true },
              message: {
                type: 'string',
                description: '확인 메시지',
                example: '주문이 확인되었습니다.',
              },
            },
          },
          400: { $ref: 'ErrorResponse#' },
          500: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request, reply) => {
      const { sheetService } = fastify.core;
      const rowNumber = parseInt(request.params.rowNumber, 10);

      if (isNaN(rowNumber) || rowNumber < 2) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid row number. Row number must be a positive integer greater than 1.',
          statusCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      // 특정 주문을 확인 상태로 표시
      await sheetService.markSingleAsConfirmed(rowNumber);

      // 통계 캐시 무효화 (주문이 완료됨으로 변경되었으므로)
      statsCache.invalidate(/^stats:/);

      return {
        success: true,
        message: '주문이 확인되었습니다.',
      };
    }
  );

  /**
   * GET /api/orders/stats
   * 통합 통계 조회 (완료/신규/전체 주문별, 기간별)
   */
  fastify.get<{
    Querystring: {
      scope?: StatsScope;
      range?: StatsRange;
      grouping?: StatsGrouping;
      metric?: StatsMetric;
      orderType?: OrderTypeFilter;
      start?: string;
      end?: string;
      format?: 'json' | 'csv';
    };
  }>(
    '/api/orders/stats',
    {
      schema: {
        tags: ['orders'],
        summary: '통합 주문 통계 조회',
        description: '완료된 주문 기반 통계를 조회합니다. 기간, 범위, 지표 등을 선택할 수 있습니다.',
        querystring: {
          type: 'object',
          properties: {
            scope: {
              type: 'string',
              enum: ['completed', 'new', 'all'],
              description: '통계 범위 (completed: 완료 주문, new: 신규 주문, all: 전체)',
              default: 'completed',
            },
            range: {
              type: 'string',
              enum: ['6m', '12m', 'custom'],
              description: '기간 범위 (6m: 6개월, 12m: 12개월, custom: 사용자 지정)',
              default: '12m',
            },
            grouping: {
              type: 'string',
              enum: ['monthly'],
              description: '그룹화 단위 (현재 monthly만 지원)',
              default: 'monthly',
            },
            metric: {
              type: 'string',
              enum: ['quantity', 'amount'],
              description: '측정 지표',
              default: 'quantity',
            },
            orderType: {
              type: 'string',
              enum: ['all', 'customer', 'gift'],
              description: '주문 유형 필터 (all: 전체, customer: 판매, gift: 선물)',
              default: 'all',
            },
            start: {
              type: 'string',
              format: 'date',
              description: '시작일 (YYYY-MM-DD, range=custom 시 필수)',
            },
            end: {
              type: 'string',
              format: 'date',
              description: '종료일 (YYYY-MM-DD, range=custom 시 필수)',
            },
            format: {
              type: 'string',
              enum: ['json', 'csv'],
              description: '응답 형식 (json: JSON 형식, csv: CSV 파일)',
              default: 'json',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['success', 'filters', 'summary', 'sections', 'series', 'totalsByProduct', 'meta'],
            properties: {
              success: { type: 'boolean', enum: [true], example: true },
              filters: {
                type: 'object',
                required: ['scope', 'range', 'grouping', 'metric', 'orderType'],
                properties: {
                  scope: { type: 'string', example: 'completed' },
                  range: { type: 'string', example: '12m' },
                  grouping: { type: 'string', example: 'monthly' },
                  metric: { type: 'string', example: 'quantity' },
                  orderType: { type: 'string', example: 'all' },
                },
              },
              summary: {
                type: 'object',
                description: '현재 필터에 해당하는 요약 통계',
                required: [
                  'orderCount',
                  'total5kgQty',
                  'total10kgQty',
                  'total5kgAmount',
                  'total10kgAmount',
                  'totalRevenue',
                  'avgOrderAmount',
                  'dateRange',
                ],
                properties: {
                  orderCount: { type: 'integer', example: 150 },
                  total5kgQty: { type: 'integer', example: 120 },
                  total10kgQty: { type: 'integer', example: 80 },
                  total5kgAmount: { type: 'integer', example: 2400000 },
                  total10kgAmount: { type: 'integer', example: 2800000 },
                  totalRevenue: { type: 'integer', example: 5200000 },
                  avgOrderAmount: { type: 'integer', example: 35000 },
                  dateRange: {
                    type: 'object',
                    required: ['start', 'end'],
                    properties: {
                      start: { type: 'string', format: 'date', example: '2024-01-01' },
                      end: { type: 'string', format: 'date', example: '2025-01-31' },
                    },
                  },
                },
              },
              sections: {
                type: 'object',
                description: '섹션별 통계 (전체/판매/선물)',
                required: ['overall', 'sales', 'gifts'],
                properties: {
                  overall: {
                    type: 'object',
                    description: '전체 주문 통계 (매출은 판매 주문만 포함)',
                    properties: {
                      orderCount: { type: 'integer', example: 150 },
                      total5kgQty: { type: 'integer', example: 120 },
                      total10kgQty: { type: 'integer', example: 80 },
                      totalRevenue: { type: 'integer', example: 5200000 },
                    },
                  },
                  sales: {
                    type: 'object',
                    description: '판매 주문 통계 (고객 주문만)',
                    properties: {
                      orderCount: { type: 'integer', example: 140 },
                      total5kgQty: { type: 'integer', example: 115 },
                      total10kgQty: { type: 'integer', example: 75 },
                      totalRevenue: { type: 'integer', example: 5200000 },
                    },
                  },
                  gifts: {
                    type: 'object',
                    description: '선물 주문 통계 (매출은 0)',
                    properties: {
                      orderCount: { type: 'integer', example: 10 },
                      total5kgQty: { type: 'integer', example: 5 },
                      total10kgQty: { type: 'integer', example: 5 },
                      totalRevenue: { type: 'integer', example: 0 },
                    },
                  },
                },
              },
              series: {
                type: 'array',
                items: {
                  type: 'object',
                  required: [
                    'period',
                    'total5kgQty',
                    'total10kgQty',
                    'total5kgAmount',
                    'total10kgAmount',
                    'orderCount',
                    'avgOrderAmount',
                    'momGrowthPct',
                  ],
                  properties: {
                    period: { type: 'string', example: '2025-01' },
                    total5kgQty: { type: 'integer', example: 10 },
                    total10kgQty: { type: 'integer', example: 5 },
                    total5kgAmount: { type: 'integer', example: 200000 },
                    total10kgAmount: { type: 'integer', example: 175000 },
                    orderCount: { type: 'integer', example: 15 },
                    avgOrderAmount: { type: 'integer', example: 25000 },
                    momGrowthPct: { type: ['number', 'null'], example: 12.5 },
                  },
                },
              },
              totalsByProduct: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['productType', 'quantity', 'amount', 'quantityPct', 'revenuePct'],
                  properties: {
                    productType: { type: 'string', enum: ['비상품', '5kg', '10kg'], example: '5kg' },
                    quantity: { type: 'integer', example: 120 },
                    amount: { type: 'integer', example: 2400000 },
                    quantityPct: { type: 'number', example: 60.0 },
                    revenuePct: { type: 'number', example: 46.15 },
                  },
                },
              },
              meta: {
                type: 'object',
                required: ['generatedAt', 'currency'],
                properties: {
                  generatedAt: { type: 'string', format: 'date-time', example: '2025-01-28T12:00:00Z' },
                  currency: { type: 'string', enum: ['KRW'], example: 'KRW' },
                },
              },
            },
          },
          400: { $ref: 'ErrorResponse#' },
          500: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request, reply) => {
      const { sheetService, config } = fastify.core;

      // Query parameter 기본값 설정
      const scope: StatsScope = request.query.scope || 'completed';
      const range: StatsRange = request.query.range || '12m';
      const grouping: StatsGrouping = request.query.grouping || 'monthly';
      const metric: StatsMetric = request.query.metric || 'quantity';
      const orderType: OrderTypeFilter = request.query.orderType || 'all';
      const format = request.query.format || 'json';

      // Custom 범위인 경우 start/end 검증
      let customStart: Date | undefined;
      let customEnd: Date | undefined;

      if (range === 'custom') {
        if (!request.query.start || !request.query.end) {
          return reply.code(400).send({
            success: false,
            error: 'start and end dates are required when range=custom',
            statusCode: 400,
            timestamp: new Date().toISOString(),
          });
        }

        try {
          customStart = new Date(request.query.start);
          customEnd = new Date(request.query.end);

          if (isNaN(customStart.getTime()) || isNaN(customEnd.getTime())) {
            throw new Error('Invalid date format');
          }

          if (customStart > customEnd) {
            return reply.code(400).send({
              success: false,
              error: 'start date must be before or equal to end date',
              statusCode: 400,
              timestamp: new Date().toISOString(),
            });
          }
        } catch (error) {
          return reply.code(400).send({
            success: false,
            error: 'Invalid date format. Use YYYY-MM-DD',
            statusCode: 400,
            timestamp: new Date().toISOString(),
          });
        }
      }

      // 캐시 확인
      const cacheKey = getStatsCacheKey(scope, range, grouping, metric, orderType, customStart, customEnd);
      const cachedStats = statsCache.get(cacheKey);

      if (cachedStats) {
        // 캐시 히트
        if (format === 'csv') {
          const csv = convertStatsToCSV(cachedStats);
          reply.header('Content-Type', 'text/csv; charset=utf-8');
          reply.header('Content-Disposition', `attachment; filename="stats-${scope}-${range}.csv"`);
          return csv;
        }
        return cachedStats;
      }

      // 캐시 미스 - 데이터 조회 및 계산
      const sheetRows = await sheetService.getOrdersByStatus(scope);
      const orders = sheetRows.map((row) => sheetRowToOrder(row, config));

      // 통계 계산
      const stats = calculateStats(orders, config, {
        scope,
        range,
        grouping,
        metric,
        orderType,
        customStart,
        customEnd,
      });

      // 캐시에 저장
      statsCache.set(cacheKey, stats, STATS_CACHE_TTL);

      // CSV 형식 요청 시 CSV 문자열 반환
      if (format === 'csv') {
        const csv = convertStatsToCSV(stats);
        reply.header('Content-Type', 'text/csv; charset=utf-8');
        reply.header('Content-Disposition', `attachment; filename="stats-${scope}-${range}.csv"`);
        return csv;
      }

      // 기본값: JSON 반환
      return stats;
    }
  );

  /**
   * GET /api/orders/stats/monthly
   * 월별 주문 통계 (하위 호환성을 위해 유지)
   */
  fastify.get(
    '/api/orders/stats/monthly',
    {
      schema: {
        tags: ['orders'],
        summary: '월별 주문 통계 조회',
        description: '최근 12개월간의 월별 주문 통계를 조회합니다.',
        response: {
          200: {
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true], example: true },
              data: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['month', 'total5kg', 'total10kg', 'count'],
                  properties: {
                    month: { type: 'string', description: '월 (YYYY-MM)', example: '2025-01' },
                    total5kg: { type: 'integer', description: '5kg 수량', example: 10 },
                    total10kg: { type: 'integer', description: '10kg 수량', example: 5 },
                    count: { type: 'integer', description: '주문 개수', example: 15 },
                  },
                },
              },
            },
          },
          500: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async () => {
      const { sheetService, config } = fastify.core;

      // 모든 주문 가져오기 (확인된 주문 포함)
      const sheetRows = await sheetService.getAllRows();
      const orders = sheetRows.map((row) => sheetRowToOrder(row, config));

      // 월별로 그룹화
      const monthlyStats = new Map<string, { total5kg: number; total10kg: number; count: number }>();

      orders.forEach((order) => {
        const date = new Date(order.timestamp);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

        if (!monthlyStats.has(monthKey)) {
          monthlyStats.set(monthKey, { total5kg: 0, total10kg: 0, count: 0 });
        }

        const stats = monthlyStats.get(monthKey)!;
        stats.count += 1;

        if (order.productType === '5kg') {
          stats.total5kg += order.quantity;
        } else if (order.productType === '10kg') {
          stats.total10kg += order.quantity;
        }
      });

      // 최근 12개월로 제한하고 정렬
      const now = new Date();
      const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

      const result = Array.from(monthlyStats.entries())
        .map(([month, stats]) => ({
          month,
          ...stats,
        }))
        .filter((item) => {
          const [year, monthStr] = item.month.split('-').map(Number);
          const itemDate = new Date(year, monthStr - 1, 1);
          return itemDate >= twelveMonthsAgo && itemDate <= now;
        })
        .sort((a, b) => a.month.localeCompare(b.month));

      return {
        success: true,
        data: result,
      };
    }
  );
};

export default ordersRoutes;
