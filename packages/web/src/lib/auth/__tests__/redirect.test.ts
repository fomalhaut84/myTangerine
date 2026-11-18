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

  it.each([null, undefined, '', 'orders', '//evil.example.com', '/\\evil.example.com', 'https://evil.example.com', '/login', '/login?next=/x'])(
    'falls back to /dashboard for %s',
    (input) => {
      expect(safeNextPath(input)).toBe('/dashboard');
    }
  );
});
