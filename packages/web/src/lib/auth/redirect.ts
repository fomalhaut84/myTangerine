/**
 * 로그인 뒤 이동할 경로 (#219) — 같은 사이트 안의 경로만 허용한다(열린 리다이렉트 방지).
 */

export const DEFAULT_AFTER_LOGIN = '/dashboard';

export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/')) return DEFAULT_AFTER_LOGIN;
  // `//host` · `/\host` 는 브라우저가 다른 호스트로 해석한다
  if (next.startsWith('//') || next.startsWith('/\\')) return DEFAULT_AFTER_LOGIN;
  if (next === '/login' || next.startsWith('/login?') || next.startsWith('/login/')) return DEFAULT_AFTER_LOGIN;
  return next;
}
