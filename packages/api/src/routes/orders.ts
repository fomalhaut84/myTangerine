/**
 * 주문 관련 API 라우트
 */

import { FastifyPluginAsync } from 'fastify';
import { sheetRowToOrder } from '@mytangerine/core';

/**
 * 주문 라우트
 */
const ordersRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/orders
   * 새로운 주문 조회
   */
  fastify.get(
    '/api/orders',
    {
      schema: {
        tags: ['orders'],
        summary: '새로운 주문 목록 조회',
        description: '비고가 "확인"이 아닌 새로운 주문들을 조회합니다.',
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
    async () => {
    const { sheetService, config } = fastify.core;

    // 새로운 주문 가져오기
    const sheetRows = await sheetService.getNewOrders();

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

    // 5kg, 10kg 수량 집계
    let total5kg = 0;
    let total10kg = 0;

    orders.forEach((order) => {
      if (order.productType === '5kg') {
        total5kg += order.quantity;
      } else if (order.productType === '10kg') {
        total10kg += order.quantity;
      }
    });

    // 가격 계산
    const price5kg = total5kg * config.productPrices['5kg'];
    const price10kg = total10kg * config.productPrices['10kg'];
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

    // 먼저 새로운 주문을 가져와서 newOrderRows를 갱신
    const newOrders = await sheetService.getNewOrders();

    if (newOrders.length === 0) {
      return {
        success: true,
        message: '확인할 새로운 주문이 없습니다.',
        confirmedCount: 0,
      };
    }

    // 주문을 확인 상태로 표시
    await sheetService.markAsConfirmed();

    return {
      success: true,
      message: `${newOrders.length}개의 주문이 확인되었습니다.`,
      confirmedCount: newOrders.length,
    };
  });

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
    async (request) => {
      const { sheetService } = fastify.core;
      const rowNumber = parseInt(request.params.rowNumber, 10);

      if (isNaN(rowNumber) || rowNumber < 2) {
        throw new Error('Invalid row number');
      }

      // 특정 주문을 확인 상태로 표시
      await sheetService.markSingleAsConfirmed(rowNumber);

      return {
        success: true,
        message: '주문이 확인되었습니다.',
      };
    }
  );

  /**
   * GET /api/orders/stats/monthly
   * 월별 주문 통계
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
