/**
 * 인증 미들웨어
 * API 키 기반 간단한 인증
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { API_KEY_HEADER, apiKeyFailure, verifyApiKey } from '../security/api-key.js';

/**
 * API 키 검증 미들웨어
 * 환경 변수 API_SECRET_KEY와 요청 헤더의 x-api-key를 비교 (상수시간 · #218).
 * 전역 훅(plugins/api-key-auth.ts)이 이미 검사한다 — sync 라우트의 이중 방어로 남겨 둔다
 */
export async function requireApiKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const result = verifyApiKey(request.headers[API_KEY_HEADER], process.env.API_SECRET_KEY);
  if (result === 'ok') {
    request.log.debug('API key authentication successful');
    return;
  }
  if (result === 'unconfigured') {
    request.log.error('API_SECRET_KEY not configured');
  }
  const { statusCode, body } = apiKeyFailure(result);
  return reply.code(statusCode).send(body);
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
        message: 'Client is not allowed to access this endpoint',
        statusCode: 403,
        timestamp: new Date().toISOString(),
      });
    }

    request.log.debug({ appClient }, 'App client authentication successful');
  };
}
