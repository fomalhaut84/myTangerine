// @vitest-environment node
/**
 * 페이지·웹 API 보호 (#219)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '../proxy';
import { createSessionToken, sessionKey, SESSION_COOKIE } from '../lib/auth/session';

const SECRET = 's'.repeat(48);
const HASH = 'scrypt:16384:8:1:c2FsdA==:a2V5';
const saved = { secret: process.env.SESSION_SECRET, hash: process.env.ADMIN_PASSWORD_HASH };
const validToken = () => createSessionToken(sessionKey(SECRET, HASH) as string, Date.now());

function req(path: string, cookie?: string): NextRequest {
  const headers = new Headers();
  if (cookie) headers.set('cookie', `${SESSION_COOKIE}=${cookie}`);
  return new NextRequest(new URL(path, 'https://web.example.com'), { headers });
}

describe('proxy', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = SECRET;
    process.env.ADMIN_PASSWORD_HASH = HASH;
  });
  afterEach(() => {
    for (const [key, value] of [
      ['SESSION_SECRET', saved.secret],
      ['ADMIN_PASSWORD_HASH', saved.hash],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('redirects a page request without a session to /login with next', () => {
    const res = proxy(req('/orders?status=new'));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('next')).toBe('/orders?status=new');
  });

  it('returns 401 JSON for a web API route without a session', async () => {
    const res = proxy(req('/api/sync'));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ success: false });
  });

  it('passes through with a valid session', () => {
    const res = proxy(req('/orders', validToken()));
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('rejects a forged session', () => {
    const res = proxy(req('/orders', 'v1.9999999999999.forged'));
    expect(res.status).toBe(307);
  });

  it.each(['/login', '/auth/login'])('leaves %s open', (path) => {
    const res = proxy(req(path));
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('protects logout too (needs a session to be meaningful)', () => {
    expect(proxy(req('/auth/logout')).status).toBe(401);
  });

  it('fails closed when SESSION_SECRET is missing', () => {
    const token = validToken();
    delete process.env.SESSION_SECRET;
    expect(proxy(req('/orders', token)).status).toBe(307);
  });

  it('rejects a token signed with the bare secret (key must include the password hash)', () => {
    const res = proxy(req('/orders', createSessionToken(SECRET, Date.now())));
    expect(res.status).toBe(307);
  });

  it('invalidates sessions when the password hash changes', () => {
    const token = validToken();
    process.env.ADMIN_PASSWORD_HASH = `${HASH}x`;
    expect(proxy(req('/orders', token)).status).toBe(307);
  });
});
