/**
 * 관리자 로그인 (#219)
 *
 * /api 가 아닌 /auth 아래에 둔다 — 운영 리버스 프록시가 /api 를 API 서버로 보낼 수 있다.
 * 실패 응답은 원인(비밀번호 틀림 · 설정 없음)을 구분해 알리지 않는다. 설정 누락만 503 으로 구분한다.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createSessionToken } from '@/lib/auth/session';
import { verifyPassword } from '@/lib/auth/password';
import { sessionCookie } from '@/lib/auth/cookie';
import { clientIpFrom, loginThrottle } from '@/lib/auth/login-throttle';

const MAX_PASSWORD_LENGTH = 256;

function fail(status: number, message: string) {
  return NextResponse.json({ success: false, message }, { status });
}

async function readPassword(request: NextRequest): Promise<string | null> {
  try {
    const body: unknown = await request.json();
    if (typeof body !== 'object' || body === null) return null;
    const password = (body as { password?: unknown }).password;
    if (typeof password !== 'string' || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
      return null;
    }
    return password;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const secret = process.env.SESSION_SECRET;
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  if (!secret || !passwordHash) {
    console.error('[auth] SESSION_SECRET 또는 ADMIN_PASSWORD_HASH 가 설정되지 않았습니다');
    return fail(503, '로그인을 사용할 수 없습니다. 서버 설정을 확인하세요.');
  }

  const client = clientIpFrom(request.headers);
  if (loginThrottle.isBlocked(client)) {
    return fail(429, '로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.');
  }

  const password = await readPassword(request);
  if (password === null) {
    return fail(400, '비밀번호를 입력하세요.');
  }

  if (!(await verifyPassword(password, passwordHash))) {
    loginThrottle.recordFailure(client);
    console.warn('[auth] 로그인 실패', { client });
    return fail(401, '비밀번호가 올바르지 않습니다.');
  }

  loginThrottle.recordSuccess(client);
  const response = NextResponse.json({ success: true });
  response.cookies.set(sessionCookie(createSessionToken(secret)));
  return response;
}
