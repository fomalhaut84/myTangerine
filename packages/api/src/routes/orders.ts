/**
 * 주문 관련 API 라우트
 */

import { FastifyPluginAsync } from 'fastify';
import { sheetRowToOrder, mapOrdersToPdfRows, mapOrdersToExcelRows, normalizeOrderStatus, ChangeLogService } from '@mytangerine/core';
import {
  calculateStats,
  calculateOrderAmount,
  filterOrdersBySeason,
  isSeasonalScope,
  type StatsScope,
  type StatsRange,
  type StatsGrouping,
  type StatsMetric,
  type StatsResponse,
  type OrderTypeFilter,
} from '../utils/stats.js';
import { InMemoryCache } from '../utils/cache.js';
import { generatePdfBuffer } from '../utils/pdf-generator.js';
import { generateExcelBuffer } from '../utils/excel-generator.js';

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
    Querystring: { status?: 'new' | 'pending_payment' | 'completed' | 'all' };
  }>(
    '/api/orders',
    {
      schema: {
        tags: ['orders'],
        summary: '주문 목록 조회',
        description: 'Status별로 주문들을 조회합니다. 기본값은 새로운 주문입니다.',
        querystring: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['new', 'pending_payment', 'completed', 'all'],
              description: '주문 상태 필터 (new: 신규주문, pending_payment: 입금확인, completed: 배송완료, all: 전체)',
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
    const { dataService, config } = fastify.core;
    const status = request.query.status || 'new';

    // Status별 주문 가져오기
    const sheetRows = await dataService.getOrdersByStatus(status);

    // SheetRow를 Order로 변환
    // Issue #155: claim 주문은 목록에서 제외 (sheetRowNumber가 null이라 rowNumber=0으로 표시됨)
    // claim 주문은 원본 주문 상세 페이지의 "원본 주문" 링크로만 접근 가능
    const orders = sheetRows
      .filter((row) => row._orderType !== 'claim')
      .map((row) => sheetRowToOrder(row, config));

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
        orderType: order.orderType,
        isDeleted: order.isDeleted,
        deletedAt: order.deletedAt?.toISOString(),
        trackingNumber: order.trackingNumber,
        ordererName: order.ordererName,
        ordererEmail: order.ordererEmail,
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
    const { dataService, config } = fastify.core;

    // 새로운 주문 가져오기
    const sheetRows = await dataService.getNewOrders();

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
    const { dataService } = fastify.core;

    // 먼저 새로운 주문을 가져오기
    const newOrders = await dataService.getNewOrders();

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
    await dataService.markAsConfirmed(rowNumbers);

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
        const allRows = await fastify.core.dataService.getAllRows();
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
        const allRows = await fastify.core.dataService.getAllRows();
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
   * GET /api/orders/report/excel
   * 주문 목록 Excel 내보내기
   * Issue #113: 주문 목록 Excel 내보내기
   */
  fastify.get(
    '/api/orders/report/excel',
    {
      schema: {
        tags: ['orders'],
        summary: 'Excel 형식으로 주문 목록 다운로드',
        description: '필터링된 주문 목록을 Excel 파일로 생성하여 다운로드합니다.',
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
            description: 'Excel 파일 (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet)',
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
        const allRows = await fastify.core.dataService.getAllRows();
        const allOrders = allRows.map((row) => sheetRowToOrder(row, fastify.core.config));

        // 공통 헬퍼 함수로 주문 처리
        const { orders: paginatedOrders, filterDescription } = processOrdersForPdfReport(
          allOrders,
          { rowNumbers, status, from, to, sort, order, limit, offset }
        );

        // Excel 데이터 변환 및 생성
        const excelRows = mapOrdersToExcelRows(paginatedOrders);
        const excelBuffer = await generateExcelBuffer(excelRows, {
          title: '현애순(딸) 주문목록',
          includeTimestamp: true,
          filterDescription,
        });

        // 파일명 생성 (YYYYMMDD 형식)
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
        const filename = `orders-report-${dateStr}.xlsx`;

        // 응답 헤더 설정
        reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        reply.header('Content-Disposition', `attachment; filename="${filename}"`);
        reply.header('X-Order-Count', paginatedOrders.length.toString());
        reply.header('X-Generated-At', now.toISOString());

        return reply.send(excelBuffer);
      } catch (error) {
        fastify.log.error(error, 'Excel 생성 중 오류 발생');
        return reply.status(500).send({
          error: 'EXCEL_GENERATION_ERROR',
          message: error instanceof Error ? error.message : 'Excel 생성 실패',
        });
      }
    }
  );

  /**
   * POST /api/orders/report/excel
   * 주문 목록 Excel 내보내기 (POST 버전)
   * Issue #113: 모바일 환경 대응 - URL 길이 제한 우회
   */
  fastify.post(
    '/api/orders/report/excel',
    {
      schema: {
        tags: ['orders'],
        summary: 'Excel 형식으로 주문 목록 다운로드 (POST)',
        description:
          '필터링된 주문 목록을 Excel 파일로 생성하여 다운로드합니다. ' +
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
            description: 'Excel 파일 (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet)',
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
        const allRows = await fastify.core.dataService.getAllRows();
        const allOrders = allRows.map((row) => sheetRowToOrder(row, fastify.core.config));

        // 공통 헬퍼 함수로 주문 처리
        const { orders: paginatedOrders, filterDescription } = processOrdersForPdfReport(
          allOrders,
          { rowNumbers, status, from, to, sort, order, limit, offset }
        );

        // Excel 데이터 변환 및 생성
        const excelRows = mapOrdersToExcelRows(paginatedOrders);
        const excelBuffer = await generateExcelBuffer(excelRows, {
          title: '현애순(딸) 주문목록',
          includeTimestamp: true,
          filterDescription,
        });

        // 파일명 생성 (YYYYMMDD 형식)
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
        const filename = `orders-report-${dateStr}.xlsx`;

        // 응답 헤더 설정
        reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        reply.header('Content-Disposition', `attachment; filename="${filename}"`);
        reply.header('X-Order-Count', paginatedOrders.length.toString());
        reply.header('X-Generated-At', now.toISOString());

        return reply.send(excelBuffer);
      } catch (error) {
        fastify.log.error(error, 'Excel 생성 중 오류 발생');
        return reply.status(500).send({
          error: 'EXCEL_GENERATION_ERROR',
          message: error instanceof Error ? error.message : 'Excel 생성 실패',
        });
      }
    }
  );

  /**
   * GET /api/orders/:rowNumber
   * 특정 주문 조회
   * Issue #155: idType=dbId 쿼리 파라미터로 DB ID 직접 조회 지원 (claim 주문)
   */
  fastify.get<{
    Params: { rowNumber: string };
    Querystring: { idType?: 'rowNumber' | 'dbId' };
  }>(
    '/api/orders/:rowNumber',
    {
      schema: {
        tags: ['orders'],
        summary: '특정 주문 조회',
        description: '주문 ID로 특정 주문을 조회합니다. 기본값은 sheetRowNumber로 조회하며, idType=dbId 시 DB ID로 조회합니다.',
        params: {
          type: 'object',
          required: ['rowNumber'],
          properties: {
            rowNumber: {
              type: 'string',
              description: '주문 ID (sheetRowNumber 또는 DB ID)',
              example: '5',
            },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            idType: {
              type: 'string',
              enum: ['rowNumber', 'dbId'],
              default: 'rowNumber',
              description: 'ID 유형: rowNumber(스프레드시트 행), dbId(DB ID, claim 주문용)',
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
      const { dataService, config } = fastify.core;

      // 엄격한 숫자 검증: "2foo" 같은 값을 거부
      const orderId = Number(request.params.rowNumber);

      if (!Number.isInteger(orderId) || orderId < 1) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid order ID. Must be a positive integer.',
          statusCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      // Issue #155: idType에 따라 조회 방식 결정
      const idType = request.query.idType || 'rowNumber';
      let sheetRow;

      if (idType === 'dbId') {
        // DB ID로만 조회 (claim 주문용)
        sheetRow = await dataService.getOrderById(orderId);
      } else {
        // 기본: sheetRowNumber로 먼저 조회, 없으면 DB id로 폴백
        sheetRow = await dataService.getOrderByRowNumber(orderId);
        if (!sheetRow) {
          sheetRow = await dataService.getOrderById(orderId);
        }
      }

      if (!sheetRow) {
        return reply.code(404).send({
          success: false,
          error: `Order not found: ${orderId}`,
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
          orderType: order.orderType,
          isDeleted: order.isDeleted,
          deletedAt: order.deletedAt?.toISOString(),
          trackingNumber: order.trackingNumber,
          ordererName: order.ordererName,
          ordererEmail: order.ordererEmail,
          // Issue #155: 배송사고 원본 주문 참조
          originalRowNumber: sheetRow._originalRowNumber,
        },
      };
    }
  );

  /**
   * PATCH /api/orders/:rowNumber
   * 주문 정보 수정 (Issue #136)
   */
  fastify.patch<{
    Params: { rowNumber: string };
    Body: {
      sender?: { name?: string; phone?: string; address?: string };
      recipient?: { name?: string; phone?: string; address?: string };
      // 상품 타입/수량은 수정 불가 (정책: 주문 시 결정되는 핵심 정보)
      // Issue #152: claim 추가
      orderType?: 'customer' | 'gift' | 'claim';
      trackingNumber?: string;
    };
  }>(
    '/api/orders/:rowNumber',
    {
      schema: {
        tags: ['orders'],
        summary: '주문 정보 수정',
        description: '주문의 수취인/발송인 정보, 주문 유형, 송장번호를 수정합니다. 상품 타입/수량은 수정 불가.',
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
        body: {
          type: 'object',
          minProperties: 1,
          additionalProperties: false,
          properties: {
            sender: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', description: '발송인 이름' },
                phone: { type: 'string', description: '발송인 전화번호' },
                address: { type: 'string', description: '발송인 주소' },
              },
            },
            recipient: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', description: '수취인 이름' },
                phone: { type: 'string', description: '수취인 전화번호' },
                address: { type: 'string', description: '수취인 주소' },
              },
            },
            // 상품 타입/수량은 수정 불가 (정책: 주문 시 결정되는 핵심 정보)
            orderType: {
              type: 'string',
              enum: ['customer', 'gift', 'claim'],
              description: '주문 유형 (customer: 판매, gift: 선물, claim: 배송사고)',
            },
            trackingNumber: {
              type: 'string',
              description: '송장번호 (입금확인/배송완료 상태에서만 수정 가능)',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['success', 'message', 'order'],
            properties: {
              success: { type: 'boolean', enum: [true], example: true },
              message: { type: 'string', example: '주문이 수정되었습니다.' },
              order: { $ref: 'Order#' },
            },
          },
          400: { $ref: 'ErrorResponse#' },
          404: { $ref: 'ErrorResponse#' },
          409: { $ref: 'ErrorResponse#' },
          500: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request, reply) => {
      const { dataService, config } = fastify.core;
      const rowNumber = parseInt(request.params.rowNumber, 10);
      const updates = request.body;

      // 행 번호 검증
      if (isNaN(rowNumber) || rowNumber < 2) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid row number. Row number must be a positive integer greater than 1.',
          statusCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      // 주문 존재 여부 확인
      const sheetRow = await dataService.getOrderByRowNumber(rowNumber);
      if (!sheetRow) {
        return reply.code(404).send({
          success: false,
          error: `Order not found at row ${rowNumber}`,
          statusCode: 404,
          timestamp: new Date().toISOString(),
        });
      }

      // 삭제된 주문은 수정 불가
      const isDeleted = sheetRow._isDeleted || (sheetRow['삭제됨'] && sheetRow['삭제됨'].trim() !== '');
      if (isDeleted) {
        return reply.code(400).send({
          success: false,
          error: 'Cannot modify deleted order. Please restore it first.',
          statusCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      // 상태별 제약 검증
      const currentStatus = normalizeOrderStatus(sheetRow['비고']);

      // 송장번호 검증
      if (updates.trackingNumber !== undefined) {
        const trimmedTracking = updates.trackingNumber.trim();

        // 신규주문 상태에서는 송장번호 수정 불가
        if (currentStatus === '신규주문') {
          return reply.code(409).send({
            success: false,
            error: '신규주문 상태에서는 송장번호를 수정할 수 없습니다. 먼저 입금확인 처리를 해주세요.',
            statusCode: 409,
            timestamp: new Date().toISOString(),
          });
        }

        // 배송완료 상태에서는 송장번호 삭제 불가 (수정만 가능)
        if (currentStatus === '배송완료' && trimmedTracking === '') {
          return reply.code(409).send({
            success: false,
            error: '배송완료 상태에서는 송장번호를 삭제할 수 없습니다.',
            statusCode: 409,
            timestamp: new Date().toISOString(),
          });
        }

        // normalize: 빈 문자열이면 빈 문자열 유지 (삭제), 아니면 앞뒤 공백 제거
        // 빈 문자열은 시트에서 빈 셀로, DB에서는 null로 처리됨
        updates.trackingNumber = trimmedTracking;
      }

      // 배송완료 상태에서는 송장번호만 수정 가능
      if (currentStatus === '배송완료') {
        const nonTrackingUpdates = Object.keys(updates).filter((key) => key !== 'trackingNumber');
        if (nonTrackingUpdates.length > 0) {
          return reply.code(409).send({
            success: false,
            error: `배송완료 상태에서는 송장번호만 수정할 수 있습니다. 수정 시도한 필드: ${nonTrackingUpdates.join(', ')}`,
            statusCode: 409,
            timestamp: new Date().toISOString(),
          });
        }
      }

      // 필드 검증
      const validationErrors: string[] = [];

      // 수취인 정보 검증
      if (updates.recipient) {
        if (updates.recipient.name !== undefined && updates.recipient.name.trim() === '') {
          validationErrors.push('수취인 이름은 필수입니다.');
        }
        if (updates.recipient.phone !== undefined && updates.recipient.phone.trim() === '') {
          validationErrors.push('수취인 전화번호는 필수입니다.');
        }
        if (updates.recipient.address !== undefined && updates.recipient.address.trim() === '') {
          validationErrors.push('수취인 주소는 필수입니다.');
        }
      }

      // 상품 타입/수량은 스키마에서 제외되어 있으므로 검증 불필요

      if (validationErrors.length > 0) {
        return reply.code(400).send({
          success: false,
          error: validationErrors.join(' '),
          statusCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      // 주문 업데이트 실행
      await dataService.updateOrder(rowNumber, updates);

      // 통계 캐시 무효화
      statsCache.invalidate(/^stats:/);

      // 업데이트된 주문 조회
      const updatedSheetRow = await dataService.getOrderByRowNumber(rowNumber);
      const order = sheetRowToOrder(updatedSheetRow!, config);

      return {
        success: true,
        message: '주문이 수정되었습니다.',
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
          orderType: order.orderType,
          isDeleted: order.isDeleted,
          deletedAt: order.deletedAt?.toISOString(),
          trackingNumber: order.trackingNumber,
          ordererName: order.ordererName,
          ordererEmail: order.ordererEmail,
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
          404: { $ref: 'ErrorResponse#' },
          500: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request, reply) => {
      const { dataService } = fastify.core;
      const rowNumber = parseInt(request.params.rowNumber, 10);

      if (isNaN(rowNumber) || rowNumber < 2) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid row number. Row number must be a positive integer greater than 1.',
          statusCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      // 주문 존재 여부 확인
      const order = await dataService.getOrderByRowNumber(rowNumber);
      if (!order) {
        return reply.code(404).send({
          success: false,
          error: `Order not found at row ${rowNumber}`,
          statusCode: 404,
          timestamp: new Date().toISOString(),
        });
      }

      // 삭제된 주문은 상태 변경 불가 (공백 문자열 제외)
      const isDeleted = order._isDeleted || (order['삭제됨'] && order['삭제됨'].trim() !== '');
      if (isDeleted) {
        return reply.code(400).send({
          success: false,
          error: 'Cannot change status of deleted order. Please restore it first.',
          statusCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      // 특정 주문을 확인 상태로 표시
      await dataService.markSingleAsConfirmed(rowNumber);

      // 통계 캐시 무효화 (주문이 완료됨으로 변경되었으므로)
      statsCache.invalidate(/^stats:/);

      return {
        success: true,
        message: '주문이 확인되었습니다.',
      };
    }
  );

  /**
   * POST /api/orders/:rowNumber/confirm-payment
   * 주문을 "입금확인" 상태로 변경 (Phase 3)
   */
  fastify.post<{
    Params: { rowNumber: string };
  }>(
    '/api/orders/:rowNumber/confirm-payment',
    {
      schema: {
        tags: ['orders'],
        summary: '입금 확인 처리',
        description: '주문을 "입금확인" 상태로 변경합니다.',
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
                description: '처리 결과 메시지',
                example: '입금이 확인되었습니다.',
              },
            },
          },
          400: { $ref: 'ErrorResponse#' },
          404: { $ref: 'ErrorResponse#' },
          500: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request, reply) => {
      const { dataService } = fastify.core;
      const rowNumber = parseInt(request.params.rowNumber, 10);

      if (isNaN(rowNumber) || rowNumber < 2) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid row number. Row number must be a positive integer greater than 1.',
          statusCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      // 주문 존재 여부 확인
      const order = await dataService.getOrderByRowNumber(rowNumber);
      if (!order) {
        return reply.code(404).send({
          success: false,
          error: `Order not found at row ${rowNumber}`,
          statusCode: 404,
          timestamp: new Date().toISOString(),
        });
      }

      // 삭제된 주문은 상태 변경 불가 (공백 문자열 제외)
      const isDeleted = order._isDeleted || (order['삭제됨'] && order['삭제됨'].trim() !== '');
      if (isDeleted) {
        return reply.code(400).send({
          success: false,
          error: 'Cannot change status of deleted order. Please restore it first.',
          statusCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      // P2 Fix: 상태 전이 검증 - 신규주문만 입금확인으로 변경 가능
      const currentStatus = normalizeOrderStatus(order['비고']);
      if (currentStatus !== '신규주문') {
        return reply.code(400).send({
          success: false,
          error: `Cannot confirm payment for order with status "${currentStatus}". Only "신규주문" orders can be confirmed.`,
          statusCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      // 입금확인 처리
      await dataService.markPaymentConfirmed([rowNumber]);

      // 통계 캐시 무효화
      statsCache.invalidate(/^stats:/);

      return {
        success: true,
        message: '입금이 확인되었습니다.',
      };
    }
  );

  /**
   * POST /api/orders/:rowNumber/mark-delivered
   * 주문을 "배송완료" 상태로 변경 (Phase 3)
   */
  fastify.post<{
    Params: { rowNumber: string };
    Body: { trackingNumber?: string };
  }>(
    '/api/orders/:rowNumber/mark-delivered',
    {
      schema: {
        tags: ['orders'],
        summary: '배송 완료 처리',
        description: '주문을 "배송완료" 상태로 변경합니다. 송장번호를 함께 저장할 수 있습니다.',
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
        body: {
          type: 'object',
          properties: {
            trackingNumber: {
              type: 'string',
              description: '송장번호 (택배사 운송장 번호)',
              example: '1234567890123',
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
                description: '처리 결과 메시지',
                example: '배송이 완료되었습니다.',
              },
            },
          },
          400: { $ref: 'ErrorResponse#' },
          404: { $ref: 'ErrorResponse#' },
          500: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request, reply) => {
      const { dataService } = fastify.core;
      const rowNumber = parseInt(request.params.rowNumber, 10);
      const { trackingNumber } = request.body || {};

      if (isNaN(rowNumber) || rowNumber < 2) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid row number. Row number must be a positive integer greater than 1.',
          statusCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      // 주문 존재 여부 확인
      const order = await dataService.getOrderByRowNumber(rowNumber);
      if (!order) {
        return reply.code(404).send({
          success: false,
          error: `Order not found at row ${rowNumber}`,
          statusCode: 404,
          timestamp: new Date().toISOString(),
        });
      }

      // 삭제된 주문은 상태 변경 불가 (공백 문자열 제외)
      const isDeleted = order._isDeleted || (order['삭제됨'] && order['삭제됨'].trim() !== '');
      if (isDeleted) {
        return reply.code(400).send({
          success: false,
          error: 'Cannot change status of deleted order. Please restore it first.',
          statusCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      // P2 Fix: 상태 전이 검증 - 입금확인만 배송완료로 변경 가능
      const currentStatus = normalizeOrderStatus(order['비고']);
      if (currentStatus !== '입금확인') {
        return reply.code(400).send({
          success: false,
          error: `Cannot mark as delivered for order with status "${currentStatus}". Only "입금확인" orders can be marked as delivered.`,
          statusCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      // 배송완료 처리 (송장번호 포함)
      await dataService.markDelivered([rowNumber], trackingNumber);

      // 통계 캐시 무효화
      statsCache.invalidate(/^stats:/);

      return {
        success: true,
        message: trackingNumber
          ? `배송이 완료되었습니다. (송장번호: ${trackingNumber})`
          : '배송이 완료되었습니다.',
      };
    }
  );

  /**
   * POST /api/orders/:rowNumber/delete
   * 주문 Soft Delete (Phase 3)
   */
  fastify.post<{
    Params: { rowNumber: string };
  }>(
    '/api/orders/:rowNumber/delete',
    {
      schema: {
        tags: ['orders'],
        summary: '주문 삭제 (Soft Delete)',
        description: '주문을 삭제합니다. 실제로 데이터는 삭제되지 않고 삭제 표시만 됩니다.',
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
                description: '처리 결과 메시지',
                example: '주문이 삭제되었습니다.',
              },
            },
          },
          400: { $ref: 'ErrorResponse#' },
          404: { $ref: 'ErrorResponse#' },
          500: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request, reply) => {
      const { dataService } = fastify.core;
      const rowNumber = parseInt(request.params.rowNumber, 10);

      if (isNaN(rowNumber) || rowNumber < 2) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid row number. Row number must be a positive integer greater than 1.',
          statusCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      // 주문 존재 여부 확인 (삭제된 주문 포함)
      const order = await dataService.getOrderByRowNumber(rowNumber);
      if (!order) {
        return reply.code(404).send({
          success: false,
          error: `Order not found at row ${rowNumber}`,
          statusCode: 404,
          timestamp: new Date().toISOString(),
        });
      }

      // 이미 삭제된 주문인 경우 idempotent 처리 (성공 응답, 공백 문자열 제외)
      const isDeleted = order._isDeleted || (order['삭제됨'] && order['삭제됨'].trim() !== '');
      if (isDeleted) {
        return {
          success: true,
          message: '주문이 이미 삭제되어 있습니다.',
        };
      }

      // Soft Delete 처리
      await dataService.softDelete([rowNumber]);

      // 통계 캐시 무효화
      statsCache.invalidate(/^stats:/);

      return {
        success: true,
        message: '주문이 삭제되었습니다.',
      };
    }
  );

  /**
   * POST /api/orders/:rowNumber/restore
   * 삭제된 주문 복원 (Phase 3)
   */
  fastify.post<{
    Params: { rowNumber: string };
  }>(
    '/api/orders/:rowNumber/restore',
    {
      schema: {
        tags: ['orders'],
        summary: '삭제된 주문 복원',
        description: 'Soft Delete된 주문을 복원합니다.',
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
                description: '처리 결과 메시지',
                example: '주문이 복원되었습니다.',
              },
            },
          },
          400: { $ref: 'ErrorResponse#' },
          404: { $ref: 'ErrorResponse#' },
          500: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request, reply) => {
      const { dataService } = fastify.core;
      const rowNumber = parseInt(request.params.rowNumber, 10);

      if (isNaN(rowNumber) || rowNumber < 2) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid row number. Row number must be a positive integer greater than 1.',
          statusCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      // 주문 존재 여부 확인 (삭제된 주문도 조회)
      const deletedOrders = await dataService.getDeletedOrders();
      const order = deletedOrders.find((o) => o._rowNumber === rowNumber);
      if (!order) {
        return reply.code(404).send({
          success: false,
          error: `Deleted order not found at row ${rowNumber}`,
          statusCode: 404,
          timestamp: new Date().toISOString(),
        });
      }

      // 복원 처리
      await dataService.restore([rowNumber]);

      // 통계 캐시 무효화
      statsCache.invalidate(/^stats:/);

      return {
        success: true,
        message: '주문이 복원되었습니다.',
      };
    }
  );

  /**
   * GET /api/orders/deleted
   * 삭제된 주문 목록 조회 (Phase 3)
   */
  fastify.get(
    '/api/orders/deleted',
    {
      schema: {
        tags: ['orders'],
        summary: '삭제된 주문 목록 조회',
        description: 'Soft Delete된 주문들을 조회합니다.',
        response: {
          200: {
            type: 'object',
            required: ['success', 'count', 'orders'],
            properties: {
              success: { type: 'boolean', enum: [true], example: true },
              count: { type: 'integer', minimum: 0, description: '삭제된 주문 개수', example: 3 },
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
    async () => {
      const { dataService, config } = fastify.core;

      // 삭제된 주문 가져오기
      const sheetRows = await dataService.getDeletedOrders();

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
          orderType: order.orderType,
          isDeleted: order.isDeleted,
          deletedAt: order.deletedAt?.toISOString(),
          trackingNumber: order.trackingNumber,
        })),
      };
    }
  );

  /**
   * GET /api/orders/stats
   * 통합 통계 조회 (신규/입금확인/배송완료/전체 주문별, 기간별)
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
        description: '주문 통계를 조회합니다. scope로 상태별(신규/입금확인/배송완료/전체) 또는 시즌별(성수기/비수기) 필터링이 가능합니다.',
        querystring: {
          type: 'object',
          properties: {
            scope: {
              type: 'string',
              enum: ['completed', 'new', 'pending_payment', 'all', 'peak_season', 'off_season'],
              description: '통계 범위 (completed: 배송완료, new: 신규주문, pending_payment: 입금확인, all: 전체, peak_season: 성수기 10~2월, off_season: 비수기 3~9월)',
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
              enum: ['all', 'customer', 'gift', 'claim'],
              description: '주문 유형 필터 (all: 전체, customer: 판매, gift: 선물, claim: 배송사고)',
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
      const { dataService, config } = fastify.core;

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
      // seasonal scope인 경우 전체 주문을 가져온 후 시즌 필터링 적용 (Issue #142)
      const dataScope = isSeasonalScope(scope) ? 'all' : scope;
      const sheetRows = await dataService.getOrdersByStatus(dataScope);
      let orders = sheetRows.map((row) => sheetRowToOrder(row, config));

      // seasonal scope인 경우 월 기준으로 필터링
      if (isSeasonalScope(scope)) {
        orders = filterOrdersBySeason(orders, scope);
      }

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
      const { dataService, config } = fastify.core;

      // 모든 주문 가져오기 (확인된 주문 포함)
      const sheetRows = await dataService.getAllRows();
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

  // =========================================
  // Phase 2: 변경 이력 + 충돌 감지 API
  // =========================================

  /**
   * GET /api/orders/:rowNumber/history
   * 주문 변경 이력 조회 (Phase 2)
   */
  fastify.get<{
    Params: { rowNumber: string };
    Querystring: { limit?: number; offset?: number };
  }>(
    '/api/orders/:rowNumber/history',
    {
      schema: {
        tags: ['orders'],
        summary: '주문 변경 이력 조회',
        description: '특정 주문의 변경 이력을 조회합니다.',
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
        querystring: {
          type: 'object',
          properties: {
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 100,
              default: 50,
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
            type: 'object',
            required: ['success', 'history'],
            properties: {
              success: { type: 'boolean', enum: [true], example: true },
              history: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'integer' },
                    changedAt: { type: 'string', format: 'date-time' },
                    changedBy: { type: 'string', enum: ['web', 'sync', 'api'] },
                    action: { type: 'string' },
                    fieldChanges: { type: 'object' },
                    previousVersion: { type: 'integer' },
                    newVersion: { type: 'integer' },
                    conflictDetected: { type: 'boolean' },
                    conflictResolution: { type: ['string', 'null'] },
                  },
                },
              },
            },
          },
          400: { $ref: 'ErrorResponse#' },
          404: { $ref: 'ErrorResponse#' },
          500: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request, reply) => {
      const rowNumber = parseInt(request.params.rowNumber, 10);
      const { limit = 50, offset = 0 } = request.query;

      if (isNaN(rowNumber) || rowNumber < 2) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid row number. Row number must be a positive integer greater than 1.',
          statusCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      // ChangeLogService 초기화
      const changeLogService = new ChangeLogService(fastify.prisma);

      // 변경 이력 조회
      const changeLogs = await changeLogService.getChangeLogsByRowNumber(rowNumber, { limit, offset });

      return {
        success: true,
        history: changeLogs.map((log) => ({
          id: log.id,
          changedAt: log.changedAt.toISOString(),
          changedBy: log.changedBy,
          action: log.action,
          fieldChanges: log.fieldChanges as Record<string, unknown>,
          previousVersion: log.previousVersion,
          newVersion: log.newVersion,
          conflictDetected: log.conflictDetected,
          conflictResolution: log.conflictResolution,
        })),
      };
    }
  );

  /**
   * GET /api/orders/conflicts
   * 충돌 목록 조회 (Phase 2)
   */
  fastify.get<{
    Querystring: { resolved?: string; limit?: number; offset?: number };
  }>(
    '/api/orders/conflicts',
    {
      schema: {
        tags: ['orders'],
        summary: '충돌 목록 조회',
        description: 'sync 과정에서 감지된 충돌 목록을 조회합니다.',
        querystring: {
          type: 'object',
          properties: {
            resolved: {
              type: 'string',
              enum: ['true', 'false', 'all'],
              default: 'all',
              description: '해결 상태 필터 (true: 해결됨, false: 미해결, all: 전체)',
            },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 100,
              default: 50,
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
            type: 'object',
            required: ['success', 'conflicts'],
            properties: {
              success: { type: 'boolean', enum: [true], example: true },
              count: { type: 'integer' },
              conflicts: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'integer' },
                    orderId: { type: 'integer' },
                    sheetRowNumber: { type: 'integer' },
                    changedAt: { type: 'string', format: 'date-time' },
                    changedBy: { type: 'string' },
                    action: { type: 'string' },
                    fieldChanges: { type: 'object' },
                    conflictResolution: { type: ['string', 'null'] },
                    order: {
                      type: 'object',
                      properties: {
                        id: { type: 'integer' },
                        recipientName: { type: ['string', 'null'] },
                        status: { type: ['string', 'null'] },
                      },
                    },
                  },
                },
              },
            },
          },
          500: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request) => {
      const { resolved = 'all', limit = 50, offset = 0 } = request.query;

      // ChangeLogService 초기화
      const changeLogService = new ChangeLogService(fastify.prisma);

      // 해결 상태 필터 변환
      let resolvedFilter: boolean | undefined;
      if (resolved === 'true') resolvedFilter = true;
      else if (resolved === 'false') resolvedFilter = false;
      // 'all'인 경우 undefined

      // 충돌 목록 조회
      const conflicts = await changeLogService.getConflicts({
        resolved: resolvedFilter,
        limit,
        offset,
      });

      return {
        success: true,
        count: conflicts.length,
        conflicts: conflicts.map((log) => ({
          id: log.id,
          orderId: log.orderId,
          sheetRowNumber: log.sheetRowNumber,
          changedAt: log.changedAt.toISOString(),
          changedBy: log.changedBy,
          action: log.action,
          fieldChanges: log.fieldChanges as Record<string, unknown>,
          conflictResolution: log.conflictResolution,
          order: log.order ? {
            id: log.order.id,
            recipientName: log.order.recipientName,
            status: log.order.status,
          } : undefined,
        })),
      };
    }
  );

  /**
   * POST /api/orders/conflicts/:conflictId/resolve
   * 충돌 해결 처리 (Phase 2)
   */
  fastify.post<{
    Params: { conflictId: string };
    Body: { resolution: 'db_wins' | 'sheet_wins' | 'manual' };
  }>(
    '/api/orders/conflicts/:conflictId/resolve',
    {
      schema: {
        tags: ['orders'],
        summary: '충돌 해결',
        description: '충돌을 해결 상태로 표시합니다.',
        params: {
          type: 'object',
          required: ['conflictId'],
          properties: {
            conflictId: {
              type: 'string',
              description: '충돌 로그 ID',
              example: '1',
            },
          },
        },
        body: {
          type: 'object',
          required: ['resolution'],
          properties: {
            resolution: {
              type: 'string',
              enum: ['db_wins', 'sheet_wins', 'manual'],
              description: '해결 방법 (db_wins: DB 우선, sheet_wins: 시트 우선, manual: 수동 해결)',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['success', 'message'],
            properties: {
              success: { type: 'boolean', enum: [true], example: true },
              message: { type: 'string' },
              conflict: {
                type: 'object',
                properties: {
                  id: { type: 'integer' },
                  conflictResolution: { type: 'string' },
                },
              },
            },
          },
          400: { $ref: 'ErrorResponse#' },
          404: { $ref: 'ErrorResponse#' },
          500: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request, reply) => {
      const conflictId = parseInt(request.params.conflictId, 10);
      const { resolution } = request.body;

      if (isNaN(conflictId) || conflictId < 1) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid conflict ID. ID must be a positive integer.',
          statusCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      // ChangeLogService 초기화
      const changeLogService = new ChangeLogService(fastify.prisma);

      try {
        const updatedConflict = await changeLogService.resolveConflict(conflictId, resolution);

        return {
          success: true,
          message: `충돌이 '${resolution}' 방식으로 해결되었습니다.`,
          conflict: {
            id: updatedConflict.id,
            conflictResolution: updatedConflict.conflictResolution,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // 9차 리뷰: 커스텀 에러 매핑 추가
        // 로그를 찾을 수 없는 경우
        if (errorMessage.includes('Change log not found')) {
          return reply.code(404).send({
            success: false,
            error: `Conflict not found with ID ${conflictId}`,
            statusCode: 404,
            timestamp: new Date().toISOString(),
          });
        }

        // 충돌 로그가 아닌 경우
        if (errorMessage.includes('Cannot resolve non-conflict log')) {
          return reply.code(400).send({
            success: false,
            error: `ID ${conflictId} is not a conflict log. Only conflict logs can be resolved.`,
            statusCode: 400,
            timestamp: new Date().toISOString(),
          });
        }

        // Prisma P2025: Record not found (레거시 지원)
        if (errorMessage.includes('Record to update not found')) {
          return reply.code(404).send({
            success: false,
            error: `Conflict not found with ID ${conflictId}`,
            statusCode: 404,
            timestamp: new Date().toISOString(),
          });
        }

        throw error;
      }
    }
  );

  /**
   * POST /api/orders/:orderId/claim
   * 배송사고 주문 생성 (Issue #152)
   * 배송완료된 원본 주문을 복제하여 orderType='claim'인 새 주문 생성
   */
  fastify.post<{
    Params: { orderId: string };
  }>(
    '/api/orders/:orderId/claim',
    {
      schema: {
        tags: ['orders'],
        summary: '배송사고 주문 생성',
        description: '배송완료된 주문을 복제하여 배송사고(claim) 주문을 생성합니다.',
        params: {
          type: 'object',
          required: ['orderId'],
          properties: {
            orderId: {
              type: 'string',
              description: '원본 주문 ID (행 번호)',
            },
          },
        },
        response: {
          201: {
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                // Issue #155: DB만 저장하므로 sheetsSynced 등 제거
                required: ['claimOrderId', 'originalOrderId', 'message'],
                properties: {
                  claimOrderId: { type: 'number', description: '생성된 배송사고 주문의 DB ID' },
                  originalOrderId: { type: 'number', description: '원본 주문의 sheetRowNumber' },
                  message: { type: 'string', description: '처리 결과 메시지' },
                },
              },
            },
          },
          400: { $ref: 'ErrorResponse#' },
          404: { $ref: 'ErrorResponse#' },
          501: { $ref: 'ErrorResponse#' },
          500: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request, reply) => {
      const { dataService } = fastify.core;
      const rowNumber = parseInt(request.params.orderId, 10);

      if (isNaN(rowNumber) || rowNumber < 1) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid order ID format',
          statusCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      try {
        const result = await dataService.createClaimOrder(rowNumber);

        // Issue #155: 배송사고는 DB에만 저장, DB id 반환
        const message = `배송사고 주문이 생성되었습니다. (DB id #${result.id})`;

        return reply.code(201).send({
          success: true,
          data: {
            claimOrderId: result.id,  // Issue #155: DB id (sheetRowNumber가 null이므로)
            originalOrderId: result.originalRowNumber,
            message,
          },
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // 주문을 찾을 수 없는 경우
        if (errorMessage.includes('Order not found')) {
          return reply.code(404).send({
            success: false,
            error: `Order not found with ID ${rowNumber}`,
            statusCode: 404,
            timestamp: new Date().toISOString(),
          });
        }

        // 배송완료 상태가 아닌 경우
        if (errorMessage.includes('Only completed orders')) {
          return reply.code(400).send({
            success: false,
            error: '배송완료 상태의 주문만 배송사고 등록이 가능합니다.',
            statusCode: 400,
            timestamp: new Date().toISOString(),
          });
        }

        // sheets mode에서 지원하지 않는 경우 (501 Not Implemented)
        if (errorMessage.includes('not supported in sheets mode')) {
          return reply.code(501).send({
            success: false,
            error: '배송사고 등록은 데이터베이스 모드에서만 지원됩니다.',
            statusCode: 501,
            timestamp: new Date().toISOString(),
          });
        }

        throw error;
      }
    }
  );
};

export default ordersRoutes;
