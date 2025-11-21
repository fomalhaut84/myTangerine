/**
 * Zod 기반 요청 검증 미들웨어
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { ZodSchema, ZodError } from 'zod';

/**
 * 검증 타겟 타입
 */
export type ValidateTarget = 'body' | 'query' | 'params';

/**
 * Zod 스키마를 사용하여 요청 데이터를 검증하는 미들웨어 팩토리
 *
 * @param schema - Zod 검증 스키마
 * @param target - 검증할 요청 부분 (body, query, params)
 * @returns Fastify preHandler 훅
 *
 * @example
 * ```typescript
 * const querySchema = z.object({
 *   limit: z.string().transform(parseInt).optional(),
 *   offset: z.string().transform(parseInt).optional(),
 * });
 *
 * fastify.get('/items', {
 *   preHandler: validate(querySchema, 'query')
 * }, async (request, reply) => {
 *   // request.query는 이제 타입 안전하고 검증됨
 * });
 * ```
 */
export function validate(schema: ZodSchema, target: ValidateTarget = 'body') {
  return async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    try {
      const data = request[target];
      const parsed = schema.parse(data);

      // 검증된 데이터로 덮어쓰기 (transform 적용)
      // @ts-expect-error - Fastify types don't allow mutation but we need it
      request[target] = parsed;
    } catch (error) {
      if (error instanceof ZodError) {
        const formattedErrors = error.errors.map((err) => ({
          path: err.path.join('.'),
          message: err.message,
        }));

        request.log.warn(
          {
            validationErrors: formattedErrors,
            target,
          },
          'Request validation failed'
        );

        // 검증 실패 응답 후 즉시 return하여 파이프라인 중단
        return reply.status(400).send({
          success: false,
          error: '요청 데이터가 유효하지 않습니다.',
          statusCode: 400,
          timestamp: new Date().toISOString(),
          details: formattedErrors,
        });
      }

      // 예상치 못한 에러는 throw하여 전역 에러 핸들러로 전달
      throw error;
    }
  };
}
