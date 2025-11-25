/**
 * 라벨 생성 관련 API 라우트
 */

import { FastifyPluginAsync } from 'fastify';
import { sheetRowToOrder, type Order } from '@mytangerine/core';

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
                schema: { $ref: 'ErrorResponse#' },
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

  /**
   * GET /api/labels/grouped
   * 날짜/발신자별로 그룹화된 라벨 데이터 반환 (JSON)
   */
  fastify.get(
    '/api/labels/grouped',
    {
      schema: {
        tags: ['labels'],
        summary: '그룹화된 라벨 데이터 조회',
        description: '날짜와 발신자별로 그룹화된 주문 데이터를 JSON으로 반환합니다.',
        response: {
          200: {
            description: '그룹화된 라벨 데이터',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    date: { type: 'string' },
                    sender: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' },
                        phone: { type: 'string' },
                        address: { type: 'string' },
                      },
                    },
                    orders: {
                      type: 'array',
                      items: { $ref: 'Order#' },
                    },
                    summary: {
                      type: 'object',
                      properties: {
                        '5kg': {
                          type: 'object',
                          properties: {
                            count: { type: 'number' },
                            amount: { type: 'number' },
                          },
                        },
                        '10kg': {
                          type: 'object',
                          properties: {
                            count: { type: 'number' },
                            amount: { type: 'number' },
                          },
                        },
                        total: { type: 'number' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    async () => {
      const { sheetService, config } = fastify.core;

      // 새로운 주문 가져오기
      const sheetRows = await sheetService.getNewOrders();

      if (sheetRows.length === 0) {
        return { success: true, data: [] };
      }

      // SheetRow를 Order로 변환
      const orders = sheetRows.map((row) => sheetRowToOrder(row, config));

      // 날짜 + 발신자별로 그룹화
      const grouped = new Map<string, Order[]>();

      orders.forEach((order) => {
        const date = new Date(order.timestamp).toLocaleDateString('ko-KR');
        const key = `${date}|${order.sender.name}|${order.sender.phone}`;

        if (!grouped.has(key)) {
          grouped.set(key, []);
        }
        grouped.get(key)!.push(order);
      });

      // 그룹별로 요약 정보 계산
      const result = Array.from(grouped.entries()).map(([key, orders]) => {
        const [date] = key.split('|');
        const sender = orders[0].sender;

        const summary = {
          '5kg': { count: 0, amount: 0 },
          '10kg': { count: 0, amount: 0 },
          total: 0,
        };

        orders.forEach((order) => {
          if (order.productType === '5kg') {
            summary['5kg'].count += order.quantity;
            summary['5kg'].amount += config.productPrices['5kg'] * order.quantity;
          } else if (order.productType === '10kg') {
            summary['10kg'].count += order.quantity;
            summary['10kg'].amount += config.productPrices['10kg'] * order.quantity;
          }
        });

        summary.total = summary['5kg'].amount + summary['10kg'].amount;

        return {
          date,
          sender,
          orders,
          summary,
        };
      });

      // 날짜순 정렬
      result.sort((a, b) => {
        const dateA = new Date(a.orders[0].timestamp);
        const dateB = new Date(b.orders[0].timestamp);
        return dateA.getTime() - dateB.getTime();
      });

      return { success: true, data: result };
    }
  );
};

export default labelsRoutes;
