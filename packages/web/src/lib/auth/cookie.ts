/**
 * 세션 쿠키 옵션 (#219)
 *
 * Secure 는 운영 기본 켬. HTTPS 가 아닌 운영 환경이면 쿠키가 저장되지 않으므로
 * 그때만 SESSION_COOKIE_SECURE=false 로 끈다.
 */

import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from './session';

function isSecure(): boolean {
  const flag = process.env.SESSION_COOKIE_SECURE;
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

export function sessionCookie(token: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: isSecure(),
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export function clearedSessionCookie() {
  return { ...sessionCookie(''), maxAge: 0 };
}
