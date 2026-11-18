/**
 * 관리자 로그인 (#219)
 *
 * /api 가 아닌 /auth 아래에 둔다 — 운영 리버스 프록시가 /api 를 API 서버로 보낼 수 있다.
 * 실패 응답은 원인(비밀번호 틀림 · 설정 없음)을 구분해 알리지 않는다. 설정 누락만 503 으로 구분한다.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createSessionToken, sessionKey } from '@/lib/auth/session';
import { verifyPassword } from '@/lib/auth/password';
import { sessionCookie } from '@/lib/auth/cookie';
import {
  GLOBAL_CLIENT,
  LOGIN_MAX_CONCURRENT,
  clientIpFrom,
  globalLoginThrottle,
  loginThrottle,
} from '@/lib/auth/login-throttle';

const MAX_PASSWORD_LENGTH = 256;

let inFlight = 0;

function fail(status: number, message: string) {
  return NextResponse.json(
    { success: false, message },
    { status, headers: { 'Cache-Control': 'no-store' } }
  );
}

const TOO_MANY = '로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.';

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
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  const key = sessionKey(process.env.SESSION_SECRET, passwordHash);
  if (!key || !passwordHash) {
    console.error('[auth] SESSION_SECRET(32자 이상) 또는 ADMIN_PASSWORD_HASH 가 설정되지 않았습니다');
    return fail(503, '로그인을 사용할 수 없습니다. 서버 설정을 확인하세요.');
  }

  const password = await readPassword(request);
  if (password === null) {
    return fail(400, '비밀번호를 입력하세요.');
  }

  // 여기부터 검증 시작까지 await 가 없다 — 검사·기록 사이에 다른 요청이 끼어들지 못한다
  const client = clientIpFrom(request.headers);
  if (
    loginThrottle.isBlocked(client) ||
    globalLoginThrottle.isBlocked(GLOBAL_CLIENT) ||
    inFlight >= LOGIN_MAX_CONCURRENT
  ) {
    return fail(429, TOO_MANY);
  }

  // 검증 전에 시도를 먼저 센다 — 검증(scrypt)을 기다리는 동안 들어온 동시 요청도 다음 검사에 걸린다.
  // 성공하면 그 클라이언트의 기록을 지운다(전역 기록은 지우지 않는다 — 성공도 창당 상한에 든다)
  loginThrottle.recordFailure(client);
  globalLoginThrottle.recordFailure(GLOBAL_CLIENT);

  inFlight += 1;
  let valid: boolean;
  try {
    valid = await verifyPassword(password, passwordHash);
  } finally {
    inFlight -= 1;
  }

  if (!valid) {
    console.warn('[auth] 로그인 실패', { client });
    return fail(401, '비밀번호가 올바르지 않습니다.');
  }

  loginThrottle.recordSuccess(client);
  const response = NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(sessionCookie(createSessionToken(key)));
  return response;
}
