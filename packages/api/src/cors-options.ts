/**
 * CORS 설정 — 운영 서버(index.ts)와 테스트 서버가 같은 설정을 쓴다.
 *
 * @fastify/cors 11 은 methods 기본값이 GET,HEAD,POST 로 줄었다(9 는 PUT·PATCH·DELETE 포함).
 * 웹은 다른 오리진(NEXT_PUBLIC_API_BASE_URL)에서 PATCH(주문 수정) 등을 부르므로 명시한다.
 * 회귀: Fastify 5 이전 사전 리뷰 major — PATCH preflight 가 막혀 주문 수정이 깨질 뻔했다.
 */
import type { FastifyCorsOptions } from '@fastify/cors';

export const CORS_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

export function buildCorsOptions(corsOrigin: string): FastifyCorsOptions {
  return {
    origin: corsOrigin === '*' ? true : corsOrigin,
    methods: CORS_METHODS,
  };
}
