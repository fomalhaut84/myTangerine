/**
 * 관리자 세션 토큰 (#219)
 *
 * 형식 `v1.<만료 epoch ms>.<HMAC-SHA256(base64url)>` — 서버 상태 없이 SESSION_SECRET 으로 서명만 검증한다.
 * 비밀을 바꾸면(SESSION_SECRET 교체) 모든 세션이 무효가 된다 — 강제 로그아웃 수단이다.
 * 서버 전용(proxy · route handler)이다. 클라이언트 컴포넌트에서 import 하지 않는다.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'mt_session';
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const VERSION = 'v1';

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createSessionToken(secret: string, nowMs: number = Date.now()): string {
  const expiresAt = nowMs + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = `${VERSION}.${expiresAt}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(
  token: string | undefined,
  secret: string | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!token || !secret) return false;

  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [version, expiresRaw, signature] = parts;
  if (version !== VERSION || !/^\d+$/.test(expiresRaw) || !signature) return false;

  const expected = Buffer.from(sign(`${version}.${expiresRaw}`, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;

  return Number(expiresRaw) > nowMs;
}
