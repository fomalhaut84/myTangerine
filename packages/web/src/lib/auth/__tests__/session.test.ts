// @vitest-environment node
/**
 * 세션 토큰 서명·검증 (#219)
 */

import { describe, it, expect } from 'vitest';
import { createSessionToken, verifySessionToken, SESSION_MAX_AGE_SECONDS } from '../session';

const SECRET = 's'.repeat(48);
const NOW = 1_800_000_000_000;

describe('session token', () => {
  it('verifies a token it created before expiry', () => {
    const token = createSessionToken(SECRET, NOW);
    expect(verifySessionToken(token, SECRET, NOW + 1000)).toBe(true);
  });

  it('rejects an expired token', () => {
    const token = createSessionToken(SECRET, NOW);
    expect(verifySessionToken(token, SECRET, NOW + SESSION_MAX_AGE_SECONDS * 1000 + 1)).toBe(false);
  });

  it('rejects a token signed with another secret', () => {
    const token = createSessionToken('o'.repeat(48), NOW);
    expect(verifySessionToken(token, SECRET, NOW)).toBe(false);
  });

  it('rejects a token whose expiry was tampered with', () => {
    const [version, , sig] = createSessionToken(SECRET, NOW).split('.');
    const forged = `${version}.${NOW + 10 ** 12}.${sig}`;
    expect(verifySessionToken(forged, SECRET, NOW)).toBe(false);
  });

  it.each([undefined, '', 'garbage', 'v1.abc.def', 'v2.1.x', 'v1..', 'v1.1.2.3'])(
    'rejects malformed token %s',
    (token) => {
      expect(verifySessionToken(token, SECRET, NOW)).toBe(false);
    }
  );

  it('rejects everything when the secret is missing', () => {
    const token = createSessionToken(SECRET, NOW);
    expect(verifySessionToken(token, undefined, NOW)).toBe(false);
  });
});
