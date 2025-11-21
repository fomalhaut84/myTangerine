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
            properties: {
              success: { type: 'boolean', example: true },
              count: { type: 'number', example: 5 },
              orders: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    timestamp: { type: 'string', format: 'date-time' },
                    timestampRaw: { type: 'string' },
                    status: { type: 'string' },
                    sender: { type: 'object' },
                    recipient: { type: 'object' },
                    productType: { type: 'string', enum: ['5kg', '10kg'] },
                    quantity: { type: 'number' },
                    rowNumber: { type: 'number' },
                  },
                },
              },
            },
          },
          500: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: false },
              error: { type: 'string' },
              statusCode: { type: 'number', example: 500 },
              timestamp: { type: 'string', format: 'date-time' },
            },
          },
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
            properties: {
              success: { type: 'boolean', example: true },
              summary: {
                type: 'object',
                properties: {
                  '5kg': {
                    type: 'object',
                    properties: {
                      count: { type: 'number', example: 10 },
                      amount: { type: 'number', example: 350000 },
                    },
                  },
                  '10kg': {
                    type: 'object',
                    properties: {
                      count: { type: 'number', example: 5 },
                      amount: { type: 'number', example: 300000 },
                    },
                  },
                  total: { type: 'number', example: 650000 },
                },
              },
            },
          },
          500: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: false },
              error: { type: 'string' },
              statusCode: { type: 'number', example: 500 },
              timestamp: { type: 'string', format: 'date-time' },
            },
          },
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
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string', example: '5개의 주문이 확인되었습니다.' },
              confirmedCount: { type: 'number', example: 5 },
            },
          },
          500: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: false },
              error: { type: 'string' },
              statusCode: { type: 'number', example: 500 },
              timestamp: { type: 'string', format: 'date-time' },
            },
          },
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
};

export default ordersRoutes;
