/**
 * CORS 설정 — 운영 서버(index.ts)와 테스트 서버가 같은 설정을 쓴다.
 *
 * @fastify/cors 11 은 methods 기본값이 GET,HEAD,POST 로 줄었다(9 는 PUT·PATCH·DELETE 포함).
 * 교차 오리진 호출을 허용할 때 PATCH(주문 수정) 등이 preflight 에서 막히지 않도록 명시한다.
 * 회귀: Fastify 5 이전 사전 리뷰 major — PATCH preflight 가 막혀 주문 수정이 깨질 뻔했다.
 *
 * CORS_ORIGIN (#218):
 * - 비어 있음(기본) → 교차 오리진 허용 안 함. 웹은 웹 서버를 거쳐 같은 오리진으로 부른다(#220)
 * - `*`           → 모든 오리진 반사. 개발 전용 — 운영에서는 config 가 기동을 막는다
 * - 쉼표 목록      → 그 오리진만 허용
 */
import type { FastifyCorsOptions } from '@fastify/cors';

export const CORS_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

export function parseCorsOrigin(corsOrigin: string): boolean | string[] {
  const trimmed = corsOrigin.trim();
  if (trimmed === '') return false;
  if (trimmed === '*') return true;
  return trimmed
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
}

export function buildCorsOptions(corsOrigin: string): FastifyCorsOptions {
  return {
    origin: parseCorsOrigin(corsOrigin),
    methods: CORS_METHODS,
  };
}
