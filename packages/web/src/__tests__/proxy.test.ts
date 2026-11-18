// @vitest-environment node
/**
 * 페이지·웹 API 보호 (#219)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '../proxy';
import { createSessionToken, SESSION_COOKIE } from '../lib/auth/session';

const SECRET = 's'.repeat(48);
const saved = process.env.SESSION_SECRET;

function req(path: string, cookie?: string): NextRequest {
  const headers = new Headers();
  if (cookie) headers.set('cookie', `${SESSION_COOKIE}=${cookie}`);
  return new NextRequest(new URL(path, 'https://web.example.com'), { headers });
}

describe('proxy', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = SECRET;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = saved;
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
    const res = proxy(req('/orders', createSessionToken(SECRET, Date.now())));
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
    delete process.env.SESSION_SECRET;
    const res = proxy(req('/orders', createSessionToken(SECRET, Date.now())));
    expect(res.status).toBe(307);
  });
});
