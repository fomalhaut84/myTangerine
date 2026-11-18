/**
 * 관리자 세션 확인 (#219) — Next 16 proxy (구 middleware).
 *
 * 세션이 없으면 페이지는 /login 으로 보내고, 웹 API 라우트(/api/* · /auth/* · /bff/*)는 401 을 준다.
 * 열려 있는 것: 로그인 화면·로그인 처리 · 정적 자원(matcher 에서 제외).
 * SESSION_SECRET(32자 이상)·ADMIN_PASSWORD_HASH 가 없으면 모든 세션을 무효로 본다(fail-closed).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, sessionKey, verifySessionToken } from './lib/auth/session';

const PUBLIC_PATHS: ReadonlySet<string> = new Set(['/login', '/auth/login']);

function isApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/') || pathname.startsWith('/auth/') || pathname.startsWith('/bff/');
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (verifySessionToken(token, sessionKey())) return NextResponse.next();

  if (isApiPath(pathname)) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized', message: '로그인이 필요합니다.' },
      { status: 401 }
    );
  }

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // 정적 자원·PWA 파일은 로그인 없이 받아야 한다(로그인 화면 렌더링·설치).
  // 확장자 기준(`.*\\.png$`)으로 열지 않는다 — `/api/x.png` 같은 경로로 보호를 건너뛸 수 있다.
  // 제외는 모두 루트 접두어라 /api · /auth 아래에는 걸리지 않는다
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|manifest\\.json|sw\\.js|workbox-).*)',
  ],
};
