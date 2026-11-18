// @vitest-environment node
/**
 * 로그인 시도 제한 (#219)
 */

import { describe, it, expect } from 'vitest';
import { LoginThrottle, clientIpFrom, globalLoginMaxFailures } from '../login-throttle';

const WINDOW = 10 * 60 * 1000;

describe('LoginThrottle', () => {
  it('allows up to the limit of failures, then blocks', () => {
    const t = new LoginThrottle({ maxFailures: 3, windowMs: WINDOW });
    for (let i = 0; i < 3; i += 1) {
      expect(t.isBlocked('1.1.1.1', 0)).toBe(false);
      t.recordFailure('1.1.1.1', 0);
    }
    expect(t.isBlocked('1.1.1.1', 0)).toBe(true);
  });

  it('tracks clients independently', () => {
    const t = new LoginThrottle({ maxFailures: 1, windowMs: WINDOW });
    t.recordFailure('1.1.1.1', 0);
    expect(t.isBlocked('1.1.1.1', 0)).toBe(true);
    expect(t.isBlocked('2.2.2.2', 0)).toBe(false);
  });

  it('unblocks after the window passes', () => {
    const t = new LoginThrottle({ maxFailures: 1, windowMs: WINDOW });
    t.recordFailure('1.1.1.1', 0);
    expect(t.isBlocked('1.1.1.1', WINDOW - 1)).toBe(true);
    expect(t.isBlocked('1.1.1.1', WINDOW + 1)).toBe(false);
  });

  it('clears failures on success', () => {
    const t = new LoginThrottle({ maxFailures: 2, windowMs: WINDOW });
    t.recordFailure('1.1.1.1', 0);
    t.recordSuccess('1.1.1.1');
    t.recordFailure('1.1.1.1', 0);
    expect(t.isBlocked('1.1.1.1', 0)).toBe(false);
  });

  it('caps the number of tracked clients', () => {
    const t = new LoginThrottle({ maxFailures: 1, windowMs: WINDOW, maxClients: 2 });
    t.recordFailure('a', 0);
    t.recordFailure('b', 0);
    t.recordFailure('c', 0);
    expect(t.size).toBeLessThanOrEqual(2);
    expect(t.isBlocked('c', 0)).toBe(true);
  });
});

describe('clientIpFrom', () => {
  it('uses the right-most X-Forwarded-For entry (added by our reverse proxy)', () => {
    expect(clientIpFrom(new Headers({ 'x-forwarded-for': '6.6.6.6, 1.2.3.4' }))).toBe('1.2.3.4');
  });

  it('falls back to X-Real-IP, then unknown', () => {
    expect(clientIpFrom(new Headers({ 'x-real-ip': '5.5.5.5' }))).toBe('5.5.5.5');
    expect(clientIpFrom(new Headers())).toBe('unknown');
  });
});

describe('globalLoginMaxFailures', () => {
  it.each([
    [undefined, 0],
    ['', 0],
    ['abc', 0],
    ['-5', 0],
    ['0', 0],
    ['30', 30],
    [' 50 ', 50],
  ])('parses %s as %s', (raw, expected) => {
    expect(globalLoginMaxFailures(raw)).toBe(expected);
  });
});
