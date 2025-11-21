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
        description:
          '새로운 주문들에 대한 포맷팅된 배송 라벨을 text/plain으로 생성합니다. 날짜와 발송인별로 그룹화되며, 각 주문은 수취인 정보(이름, 주소, 전화번호)와 수량 정보를 포함합니다. 라벨은 프린터로 직접 출력할 수 있도록 형식화되어 있습니다.',
        response: {
          200: {
            description: '포맷팅된 배송 라벨 텍스트 (text/plain)',
            content: {
              'text/plain': {
                schema: {
                  type: 'string',
                  example:
                    '====================\n2025-01-21\n====================\n\n보내는분: 홍길동 (010-1234-5678)\n주소: 서울시 강남구\n\n받으실분: 김철수\n주소: 서울시 송파구\n전화번호: 010-9876-5432\n5kg x 2박스\n\n---\n\n받으실분: 이영희\n주소: 경기도 성남시\n전화번호: 010-5555-6666\n10kg x 1박스\n\n보내는분별 수량:\n  5kg: 2 (70000원)\n  10kg: 1 (60000원)\n  합계: 130000원\n\n====================\n',
                },
              },
            },
          },
          500: {
            description: '에러 발생 시 JSON 응답',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
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
