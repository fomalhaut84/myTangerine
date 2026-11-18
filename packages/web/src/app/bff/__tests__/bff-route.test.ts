// @vitest-environment node
/**
 * 웹 서버 경유 API 호출 라우트 (#220)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST, PATCH } from '../[...path]/route';
import { createSessionToken, sessionKey, SESSION_COOKIE } from '@/lib/auth/session';

const SECRET = 's'.repeat(48);
const HASH = 'scrypt:16384:8:1:c2FsdA==:a2V5';
const API_KEY = 'k'.repeat(40);
const KEYS = ['SESSION_SECRET', 'ADMIN_PASSWORD_HASH', 'API_SECRET_KEY', 'API_INTERNAL_URL'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

function req(path: string, init: { method?: string; body?: string; session?: boolean } = {}): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (init.session !== false) {
    headers.set('cookie', `${SESSION_COOKIE}=${createSessionToken(sessionKey(SECRET, HASH) as string)}`);
  }
  return new NextRequest(new URL(path, 'https://web.example.com'), {
    method: init.method ?? 'GET',
    headers,
    body: init.body,
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

describe('/bff/[...path]', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = SECRET;
    process.env.ADMIN_PASSWORD_HASH = HASH;
    process.env.API_SECRET_KEY = API_KEY;
    process.env.API_INTERNAL_URL = 'http://127.0.0.1:3001/';
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('forwards to the internal API with the server key and query string', async () => {
    fetchMock.mockResolvedValue(new Response('{"success":true}', { headers: { 'content-type': 'application/json' } }));
    const res = await GET(req('/bff/api/orders?status=new'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:3001/api/orders?status=new');
    const headers = new Headers(init.headers);
    expect(headers.get('x-api-key')).toBe(API_KEY);
    expect(headers.get('x-app-client')).toBe('web');
    expect(headers.get('cookie')).toBeNull();
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('passes method and body through', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    await PATCH(req('/bff/api/orders/12', { method: 'PATCH', body: '{"quantity":2}' }));

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('PATCH');
    expect(new TextDecoder().decode(init.body)).toBe('{"quantity":2}');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
  });

  it('streams binary downloads with filename headers', async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    fetchMock.mockResolvedValue(
      new Response(pdf, {
        headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="l.pdf"' },
      })
    );
    const res = await POST(req('/bff/api/orders/report', { method: 'POST', body: '{"rowNumbers":[2]}' }));
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="l.pdf"');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(pdf);
  });

  it('keeps upstream error status codes', async () => {
    fetchMock.mockResolvedValue(new Response('{"success":false}', { status: 400 }));
    expect((await GET(req('/bff/api/orders/abc'))).status).toBe(400);
  });

  it('rejects requests without a session before calling the API', async () => {
    const res = await GET(req('/bff/api/orders', { session: false }));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['/bff/health', '/bff/api/orders/%2fetc', '/bff/api/orders/a%5cb', '/bff/docs'])('returns 404 for %s without calling the API', async (path) => {
    expect((await GET(req(path))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 503 when the server key is missing', async () => {
    delete process.env.API_SECRET_KEY;
    expect((await GET(req('/bff/api/orders'))).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 413 for an oversized body', async () => {
    const res = await POST(req('/bff/api/orders/report', { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1) }));
    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a timeout to 504 and a connection failure to 502 without leaking details', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));
    const timeout = await GET(req('/bff/api/orders'));
    expect(timeout.status).toBe(504);

    fetchMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:3001'));
    const refused = await GET(req('/bff/api/orders'));
    expect(refused.status).toBe(502);
    expect(await refused.text()).not.toContain('ECONNREFUSED');
  });

  it('rejects a cross-site write before calling the API (403)', async () => {
    const request = req('/bff/api/orders/12/delete', { method: 'POST', body: '{}' });
    request.headers.set('sec-fetch-site', 'cross-site');
    expect((await POST(request)).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps an undici headers timeout (fetch failed) to 504, not 502', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed', { cause: { code: 'UND_ERR_HEADERS_TIMEOUT' } }));
    expect((await POST(req('/bff/api/sync', { method: 'POST', body: '{}' }))).status).toBe(504);
  });

  it('defaults the internal URL to 127.0.0.1:3001', async () => {
    delete process.env.API_INTERNAL_URL;
    fetchMock.mockResolvedValue(new Response('{}'));
    await GET(req('/bff/api/labels'));
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:3001/api/labels');
  });
});
