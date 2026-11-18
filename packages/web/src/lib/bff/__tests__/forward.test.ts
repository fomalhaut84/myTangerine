// @vitest-environment node
/**
 * 웹 서버 경유 API 호출 — 경로·헤더 규칙 (#220)
 */

import { describe, it, expect } from 'vitest';
import {
  resolveUpstreamPath,
  pickResponseHeaders,
  timeoutFor,
  rejectUnsafeRequest,
  isTimeoutError,
  BFF_PREFIX,
} from '../forward';

describe('resolveUpstreamPath', () => {
  it.each([
    ['/bff/api/orders', '/api/orders'],
    ['/bff/api/orders/12/confirm', '/api/orders/12/confirm'],
    ['/bff/api/orders/report/excel', '/api/orders/report/excel'],
    ['/bff/api/labels/grouped', '/api/labels/grouped'],
    ['/bff/api/sync', '/api/sync'],
    ['/bff/api/sync/full', '/api/sync/full'],
    ['/bff/api/orders/conflicts/a%20b/resolve', '/api/orders/conflicts/a%20b/resolve'],
  ])('maps %s → %s', (input, expected) => {
    expect(resolveUpstreamPath(input)).toBe(expected);
  });

  it.each([
    '/bff',
    '/bff/',
    '/bff/health',
    '/bff/docs',
    '/bff/api',
    '/bff/api/other',
    '/bff/api/ordersx',
    '/bff/api/orders/../sync',
    '/bff/api/orders/%2e%2e/sync',
    '/bff/api/orders/./x',
    '/bff/api/orders//x',
    '/bff/api/orders/%2fetc',
    '/bff/api/orders/a%5cb',
    '/bff/api/orders/%E0%A4%A',
    '/other/api/orders',
  ])('rejects %s', (input) => {
    expect(resolveUpstreamPath(input)).toBeNull();
  });

  it('uses /bff as the prefix', () => {
    expect(BFF_PREFIX).toBe('/bff');
  });
});

describe('pickResponseHeaders', () => {
  it('copies only allow-listed headers and forbids caching', () => {
    const upstream = new Headers({
      'content-type': 'application/pdf',
      'content-disposition': 'attachment; filename="a.pdf"',
      'x-order-count': '3',
      'x-generated-at': '2026-11-18T00:00:00Z',
      'set-cookie': 'x=1',
      'x-ratelimit-remaining': '10',
      server: 'fastify',
      'content-length': '4',
    });
    const picked = pickResponseHeaders(upstream);
    expect(picked.get('content-type')).toBe('application/pdf');
    expect(picked.get('content-disposition')).toBe('attachment; filename="a.pdf"');
    expect(picked.get('x-order-count')).toBe('3');
    expect(picked.get('x-generated-at')).toBe('2026-11-18T00:00:00Z');
    expect(picked.get('set-cookie')).toBeNull();
    // undici 가 압축을 풀면 길이가 달라진다 — 길이는 전달하지 않는다
    expect(picked.get('content-length')).toBeNull();
    expect(picked.get('server')).toBeNull();
    expect(picked.get('cache-control')).toBe('no-store');
  });

  it('keeps retry-after for 429', () => {
    expect(pickResponseHeaders(new Headers({ 'retry-after': '60' })).get('retry-after')).toBe('60');
  });
});

describe('timeoutFor', () => {
  // 회귀(사전 리뷰 major): Node fetch 기본 상한 300초보다 길게 잡으면 502 로 잘못 끊겼다
  it('caps sync at 5 minutes (Node fetch limit), reports at 2 minutes, others at 30s', () => {
    expect(timeoutFor('/api/sync')).toBe(5 * 60 * 1000);
    expect(timeoutFor('/api/sync/full')).toBe(5 * 60 * 1000);
    expect(timeoutFor('/api/orders/report')).toBe(2 * 60 * 1000);
    expect(timeoutFor('/api/orders/report/excel')).toBe(2 * 60 * 1000);
    expect(timeoutFor('/api/orders/reports')).toBe(30 * 1000);
    expect(timeoutFor('/api/orders')).toBe(30 * 1000);
  });
});

describe('rejectUnsafeRequest', () => {
  const h = (init: Record<string, string>) => new Headers(init);

  it('lets safe methods through', () => {
    expect(rejectUnsafeRequest('GET', h({ 'sec-fetch-site': 'cross-site' }), false)).toBeNull();
  });

  it('rejects cross-site or same-site (other subdomain) writes', () => {
    expect(rejectUnsafeRequest('POST', h({ 'sec-fetch-site': 'cross-site' }), false)).toBe('cross-site');
    expect(rejectUnsafeRequest('PATCH', h({ 'sec-fetch-site': 'same-site' }), false)).toBe('cross-site');
  });

  it('accepts same-origin JSON writes and writes from clients without Sec-Fetch-Site', () => {
    const json = { 'content-type': 'application/json; charset=utf-8' };
    expect(rejectUnsafeRequest('POST', h({ ...json, 'sec-fetch-site': 'same-origin' }), true)).toBeNull();
    expect(rejectUnsafeRequest('POST', h(json), true)).toBeNull();
    expect(rejectUnsafeRequest('POST', h({}), false)).toBeNull();
  });

  it.each(['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', ''])(
    'rejects a write body of type %s',
    (type) => {
      expect(rejectUnsafeRequest('POST', h({ 'content-type': type }), true)).toBe('content-type');
    }
  );
});

describe('isTimeoutError', () => {
  it('recognises abort timeouts and undici header/body timeouts', () => {
    expect(isTimeoutError(new DOMException('t', 'TimeoutError'))).toBe(true);
    expect(isTimeoutError(new TypeError('fetch failed', { cause: { code: 'UND_ERR_HEADERS_TIMEOUT' } }))).toBe(true);
    expect(isTimeoutError(new TypeError('fetch failed', { cause: { code: 'UND_ERR_BODY_TIMEOUT' } }))).toBe(true);
  });

  it('treats connection failures as non-timeouts', () => {
    expect(isTimeoutError(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }))).toBe(false);
    expect(isTimeoutError('x')).toBe(false);
  });
});
