/**
 * 인증 미들웨어
 * API 키 기반 간단한 인증
 */

import { FastifyRequest, FastifyReply } from 'fastify';

/**
 * API 키 검증 미들웨어
 * 환경 변수 API_SECRET_KEY와 요청 헤더의 x-api-key를 비교
 */
export async function requireApiKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const apiKey = request.headers['x-api-key'];
  const expectedKey = process.env.API_SECRET_KEY;

  // API_SECRET_KEY가 설정되지 않은 경우 - fail closed
  if (!expectedKey) {
    request.log.error('API_SECRET_KEY not configured');
    return reply.code(503).send({
      success: false,
      error: 'Service Unavailable',
      message: 'API authentication is not configured',
      statusCode: 503,
      timestamp: new Date().toISOString(),
    });
  }

  // API 키가 없는 경우
  if (!apiKey) {
    return reply.code(401).send({
      success: false,
      error: 'Unauthorized',
      message: 'API key is required',
      statusCode: 401,
      timestamp: new Date().toISOString(),
    });
  }

  // API 키가 일치하지 않는 경우
  if (apiKey !== expectedKey) {
    return reply.code(403).send({
      success: false,
      error: 'Forbidden',
      message: 'Invalid API key',
      statusCode: 403,
      timestamp: new Date().toISOString(),
    });
  }

  // 인증 성공
  request.log.debug('API key authentication successful');
}

/**
 * x-app-client 헤더 검증 미들웨어
 * 특정 클라이언트만 접근 허용 (예: 'web', 'sync-service')
 */
export function requireAppClient(allowedClients: string[]) {
  return async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    const appClient = request.headers['x-app-client'];

    if (!appClient) {
      return reply.code(400).send({
        success: false,
        error: 'Bad Request',
        message: 'x-app-client header is required',
        statusCode: 400,
        timestamp: new Date().toISOString(),
      });
    }

    if (!allowedClients.includes(appClient as string)) {
      return reply.code(403).send({
        success: false,
        error: 'Forbidden',
        message: `Client '${appClient}' is not allowed to access this endpoint`,
        statusCode: 403,
        timestamp: new Date().toISOString(),
      });
    }

    request.log.debug({ appClient }, 'App client authentication successful');
  };
}
