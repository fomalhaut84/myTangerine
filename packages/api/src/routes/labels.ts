/**
 * 라벨 생성 관련 API 라우트
 */

import { FastifyPluginAsync } from 'fastify';
import { sheetRowToOrder } from '@mytangerine/core';

/**
 * 라벨 라우트
 */
const labelsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/labels
   * 포맷팅된 배송 라벨 생성
   */
  fastify.get(
    '/api/labels',
    {
      schema: {
        tags: ['labels'],
        summary: '배송 라벨 생성',
        description: '새로운 주문들에 대한 포맷팅된 배송 라벨을 생성합니다. 날짜와 발송인별로 그룹화됩니다.',
        response: {
          200: {
            type: 'string',
            description: '포맷팅된 배송 라벨 텍스트',
            examples: [
              '새로운 주문이 없습니다.',
              '====================\n2025-01-21\n====================\n\n보내는분: 홍길동\n...',
            ],
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
    async (request, reply) => {
    try {
      const { sheetService, config, labelFormatter } = fastify.core;

      // Content-Type을 text/plain으로 설정 (항상 일관된 형식)
      reply.type('text/plain; charset=utf-8');

      // 새로운 주문 가져오기
      const sheetRows = await sheetService.getNewOrders();

      if (sheetRows.length === 0) {
        return '새로운 주문이 없습니다.';
      }

      // SheetRow를 Order로 변환
      const orders = sheetRows.map((row) => sheetRowToOrder(row, config));

      // 라벨 포맷팅
      const labels = labelFormatter.formatLabels(orders);

      return labels;
    } catch (error) {
      // 에러 발생 시 Content-Type을 JSON으로 변경하고 에러를 throw
      // 전역 에러 핸들러가 처리하도록 함
      reply.type('application/json; charset=utf-8');
      throw error;
    }
  });
};

export default labelsRoutes;
