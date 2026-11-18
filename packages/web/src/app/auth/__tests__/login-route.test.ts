// @vitest-environment node
/**
 * 로그인·로그아웃 라우트 (#219)
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as login } from '../login/route';
import { POST as logout } from '../logout/route';
import { hashPassword } from '@/lib/auth/password';
import { SESSION_COOKIE, sessionKey, verifySessionToken } from '@/lib/auth/session';
import {
  GLOBAL_CLIENT,
  LOGIN_MAX_FAILURES,
  globalLoginThrottle,
  loginThrottle,
} from '@/lib/auth/login-throttle';

const SECRET = 's'.repeat(48);
const PASSWORD = 'tangerine-admin-pass';
let HASH = '';
const saved = { secret: process.env.SESSION_SECRET, hash: process.env.ADMIN_PASSWORD_HASH };

function loginReq(body: unknown, ip = '10.0.0.1'): NextRequest {
  return new NextRequest('https://web.example.com/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function cookieValue(res: Response): string | undefined {
  const header = res.headers.get('set-cookie') ?? '';
  const match = header.match(new RegExp(`${SESSION_COOKIE}=([^;]*)`));
  return match?.[1];
}

describe('auth routes', () => {
  beforeAll(async () => {
    HASH = await hashPassword(PASSWORD);
  });

  beforeEach(() => {
    process.env.SESSION_SECRET = SECRET;
    process.env.ADMIN_PASSWORD_HASH = HASH;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    for (const [key, value] of [
      ['SESSION_SECRET', saved.secret],
      ['ADMIN_PASSWORD_HASH', saved.hash],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.restoreAllMocks();
    globalLoginThrottle.recordSuccess(GLOBAL_CLIENT);
  });

  it('sets a valid HttpOnly session cookie on the right password', async () => {
    const res = await login(loginReq({ password: PASSWORD }, '10.0.0.2'));
    expect(res.status).toBe(200);
    const header = res.headers.get('set-cookie') ?? '';
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=lax/i);
    expect(verifySessionToken(cookieValue(res), sessionKey(SECRET, HASH))).toBe(true);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects a wrong password with 401 and no cookie', async () => {
    const res = await login(loginReq({ password: 'nope' }, '10.0.0.3'));
    expect(res.status).toBe(401);
    expect(cookieValue(res)).toBeUndefined();
  });

  it.each([{}, { password: '' }, { password: 1 }, 'not json', { password: 'x'.repeat(257) }])(
    'rejects bad input %s with 400',
    async (body) => {
      expect((await login(loginReq(body, '10.0.0.4'))).status).toBe(400);
    }
  );

  it('returns 503 when auth is not configured', async () => {
    delete process.env.ADMIN_PASSWORD_HASH;
    expect((await login(loginReq({ password: PASSWORD }, '10.0.0.5'))).status).toBe(503);
  });

  it.each(['short-secret', 'your_session_secret_here'])('returns 503 for a weak SESSION_SECRET (%s)', async (secret) => {
    process.env.SESSION_SECRET = secret;
    expect((await login(loginReq({ password: PASSWORD }, '10.0.0.8'))).status).toBe(503);
  });

  // 회귀(사전 리뷰 major): 검증(scrypt) 대기 중 들어온 동시 요청이 모두 제한을 통과했다
  it('does not let concurrent requests from one client exceed the limit', async () => {
    const ip = '10.0.0.9';
    const results = await Promise.all(
      Array.from({ length: 20 }, () => login(loginReq({ password: 'nope' }, ip)))
    );
    const attempted = results.filter((r) => r.status === 401).length;
    expect(attempted).toBeLessThanOrEqual(LOGIN_MAX_FAILURES);
    expect(results.every((r) => r.status === 401 || r.status === 429)).toBe(true);
    loginThrottle.recordSuccess(ip);
  });

  it('applies a global cap regardless of client IP', async () => {
    for (let i = 0; i < 40; i += 1) {
      await login(loginReq({ password: 'nope' }, `10.1.0.${i}`));
    }
    expect((await login(loginReq({ password: PASSWORD }, '10.2.0.1'))).status).toBe(429);
  });

  it('blocks a client after repeated failures, even with the right password', async () => {
    const ip = '10.0.0.6';
    for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) {
      expect((await login(loginReq({ password: 'nope' }, ip))).status).toBe(401);
    }
    expect((await login(loginReq({ password: PASSWORD }, ip))).status).toBe(429);
    // 다른 클라이언트는 영향 없음
    expect((await login(loginReq({ password: PASSWORD }, '10.0.0.7'))).status).toBe(200);
    loginThrottle.recordSuccess(ip);
  });

  it('clears the cookie on logout', async () => {
    const res = await logout();
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie') ?? '').toMatch(new RegExp(`${SESSION_COOKIE}=;.*Max-Age=0`, 'i'));
  });
});
