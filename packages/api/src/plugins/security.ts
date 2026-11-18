/**
 * 요청 보안 등록 (#218) — 요청 빈도 상한 → 전역 API 키 인증 순서.
 *
 * 상한을 먼저 걸어 키 없는 요청 폭주도 제한한다. /health 는 상한·인증 모두 면제
 * (배포 스크립트 헬스체크).
 *
 * `global: true` 는 라우트 단위 훅이라 앱 단위 인증 훅보다 **늦게** 돈다(인증 실패는 세지 않음).
 * 그래서 global 을 끄고 `server.rateLimit()` 핸들러를 앱 단위 onRequest 로 인증보다 먼저 건다 —
 * 등록되지 않은 경로(404)도 함께 센다.
 */

import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import apiKeyAuth, { PUBLIC_PATHS } from './api-key-auth.js';

export interface SecurityOptions {
  apiKey: string | undefined;
  rateLimitMax: number;
}

export const RATE_LIMIT_WINDOW = '1 minute';

export async function registerSecurity(server: FastifyInstance, opts: SecurityOptions): Promise<void> {
  await server.register(rateLimit, { global: false });
  server.addHook(
    'onRequest',
    server.rateLimit({
      max: opts.rateLimitMax,
      timeWindow: RATE_LIMIT_WINDOW,
      allowList: (request) => PUBLIC_PATHS.has(request.url.split('?')[0]),
    })
  );
  await server.register(apiKeyAuth, { apiKey: opts.apiKey });
}
