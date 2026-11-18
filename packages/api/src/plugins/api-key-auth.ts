/**
 * 전역 API 키 인증 (#218)
 *
 * 모든 요청에 x-api-key 를 요구한다. 예외는 PUBLIC_PATHS(배포 헬스체크)와 CORS preflight 뿐이다.
 * 라우트마다 preHandler 를 다는 방식은 새 라우트에서 빠뜨리기 쉬워 전역 훅으로 둔다.
 * 웹 브라우저는 이 키를 갖지 않는다 — 웹 서버가 세션을 확인한 뒤 붙여 전달한다(#220).
 */

import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { API_KEY_HEADER, apiKeyFailure, verifyApiKey } from '../security/api-key.js';

export interface ApiKeyAuthOptions {
  /** 서버 키. 비어 있으면 공개 경로 외 모든 요청을 503 으로 거부한다(fail-closed). */
  apiKey: string | undefined;
}

export const PUBLIC_PATHS: ReadonlySet<string> = new Set(['/health']);

function pathOf(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

const apiKeyAuth: FastifyPluginAsync<ApiKeyAuthOptions> = async (fastify, opts) => {
  if (!opts.apiKey) {
    fastify.log.error('API_SECRET_KEY not configured — all non-public routes will return 503');
  }

  fastify.addHook('onRequest', async (request, reply) => {
    if (request.method === 'OPTIONS') return;
    if (PUBLIC_PATHS.has(pathOf(request.url))) return;

    const result = verifyApiKey(request.headers[API_KEY_HEADER], opts.apiKey);
    if (result === 'ok') return;

    const { statusCode, body } = apiKeyFailure(result);
    request.log.warn({ statusCode, method: request.method, path: pathOf(request.url) }, 'API key rejected');
    return reply.code(statusCode).send(body);
  });
};

export default fp(apiKeyAuth, { name: 'api-key-auth' });
