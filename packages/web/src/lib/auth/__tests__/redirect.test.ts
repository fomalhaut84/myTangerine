// @vitest-environment node
/**
 * 로그인 후 이동 경로 검증 (#219) — 외부 사이트로의 열린 리다이렉트 방지
 */

import { describe, it, expect } from 'vitest';
import { safeNextPath } from '../redirect';

describe('safeNextPath', () => {
  it.each([
    ['/orders', '/orders'],
    ['/orders/12?tab=history', '/orders/12?tab=history'],
  ])('keeps internal path %s', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    '',
    'orders',
    '//evil.example.com',
    '/\\evil.example.com',
    'https://evil.example.com',
    '/login',
    '/login?next=/x',
    // 회귀(사전 리뷰 critical): URL 파서가 탭·개행을 지워 `//evil.com` 이 된다
    '/\t/evil.example.com',
    '/\n/evil.example.com',
    '/\r\n/evil.example.com',
    '/\n\\evil.example.com',
    decodeURIComponent('/%09/evil.example.com'),
    // 회귀(Codex P2): 점 세그먼트 정규화 뒤 `//evil` 이 된다
    '/.//evil.example.com',
    '/a/..//evil.example.com',
    '/%2e//evil.example.com',
  ])(
    'falls back to /dashboard for %s',
    (input) => {
      expect(safeNextPath(input)).toBe('/dashboard');
    }
  );
});
