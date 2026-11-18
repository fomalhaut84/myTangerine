/**
 * 로그인 뒤 이동할 경로 (#219) — 같은 사이트 안의 경로만 허용한다(열린 리다이렉트 방지).
 *
 * 문자열 앞부분만 보면 안 된다: URL 파서는 탭·개행을 지우고 `\` 를 `/` 로 읽어
 * `/\t/evil.com` · `/\\evil.com` 이 `//evil.com`(다른 호스트)이 된다.
 * 제어문자·역슬래시를 거부하고, 실제로 파싱해 오리진이 그대로인지 확인한다.
 */

export const DEFAULT_AFTER_LOGIN = '/dashboard';

const PROBE_ORIGIN = 'http://local.invalid';
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001f\u007f\\]/;

export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return DEFAULT_AFTER_LOGIN;
  if (UNSAFE_CHARS.test(next)) return DEFAULT_AFTER_LOGIN;

  let url: URL;
  try {
    url = new URL(next, PROBE_ORIGIN);
  } catch {
    return DEFAULT_AFTER_LOGIN;
  }
  if (url.origin !== PROBE_ORIGIN) return DEFAULT_AFTER_LOGIN;
  if (url.pathname === '/login' || url.pathname.startsWith('/login/')) return DEFAULT_AFTER_LOGIN;

  return `${url.pathname}${url.search}${url.hash}`;
}
