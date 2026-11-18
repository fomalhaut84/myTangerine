// @vitest-environment node
/**
 * 웹 서버 경유 API 호출 — 경로·헤더 규칙 (#220)
 */

import { describe, it, expect } from 'vitest';
import { resolveUpstreamPath, pickResponseHeaders, timeoutFor, BFF_PREFIX } from '../forward';

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
    });
    const picked = pickResponseHeaders(upstream);
    expect(picked.get('content-type')).toBe('application/pdf');
    expect(picked.get('content-disposition')).toBe('attachment; filename="a.pdf"');
    expect(picked.get('x-order-count')).toBe('3');
    expect(picked.get('x-generated-at')).toBe('2026-11-18T00:00:00Z');
    expect(picked.get('set-cookie')).toBeNull();
    expect(picked.get('server')).toBeNull();
    expect(picked.get('cache-control')).toBe('no-store');
  });

  it('keeps retry-after for 429', () => {
    expect(pickResponseHeaders(new Headers({ 'retry-after': '60' })).get('retry-after')).toBe('60');
  });
});

describe('timeoutFor', () => {
  it('gives sync calls the lock TTL and everything else 30s', () => {
    expect(timeoutFor('/api/sync')).toBe(20 * 60 * 1000);
    expect(timeoutFor('/api/sync/full')).toBe(20 * 60 * 1000);
    expect(timeoutFor('/api/orders')).toBe(30 * 1000);
  });
});
