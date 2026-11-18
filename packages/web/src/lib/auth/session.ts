/**
 * 관리자 세션 토큰 (#219)
 *
 * 형식 `v1.<만료 epoch ms>.<HMAC-SHA256(base64url)>` — 서버 상태 없이 SESSION_SECRET 으로 서명만 검증한다.
 * 서명 키는 SESSION_SECRET + ADMIN_PASSWORD_HASH 지문이다 — 둘 중 하나를 바꾸면(비밀번호 교체 포함)
 * 모든 세션이 무효가 된다. 강제 로그아웃 수단이다.
 * 서버 전용(proxy · route handler)이다. 클라이언트 컴포넌트에서 import 하지 않는다.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'mt_session';
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const VERSION = 'v1';

export const MIN_SESSION_SECRET_LENGTH = 32;
/** .env.example 에 적혔던(공개된) 자리표시 값 — 그대로 쓰면 누구나 토큰을 위조할 수 있다 */
const PLACEHOLDER_SECRETS: ReadonlySet<string> = new Set(['your_session_secret_here']);

/**
 * 서명 키. 설정이 없거나 약하면 undefined — 호출자는 로그인·세션을 모두 거부한다(fail-closed).
 */
export function sessionKey(
  secret: string | undefined = process.env.SESSION_SECRET,
  passwordHash: string | undefined = process.env.ADMIN_PASSWORD_HASH
): string | undefined {
  if (!secret || secret.length < MIN_SESSION_SECRET_LENGTH || PLACEHOLDER_SECRETS.has(secret)) return undefined;
  if (!passwordHash) return undefined;
  const fingerprint = createHash('sha256').update(passwordHash).digest('base64url');
  return `${secret}\u0000${fingerprint}`;
}

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
