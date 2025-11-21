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
  fastify.get('/api/labels', async (request, reply) => {
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
      fastify.log.error(error, 'Failed to generate labels');
      reply.type('application/json; charset=utf-8');
      return reply.status(500).send({
        success: false,
        error: '라벨 생성에 실패했습니다.',
      });
    }
  });
};

export default labelsRoutes;
