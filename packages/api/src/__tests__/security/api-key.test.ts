/**
 * API 키 검증 (#218)
 */

import { describe, it, expect } from 'vitest';
import { verifyApiKey } from '../../security/api-key.js';

const KEY = 'k'.repeat(40);

describe('verifyApiKey', () => {
  it('returns unconfigured when the server key is missing or empty', () => {
    expect(verifyApiKey(KEY, undefined)).toBe('unconfigured');
    expect(verifyApiKey(KEY, '')).toBe('unconfigured');
  });

  it('returns missing when the header is absent or empty', () => {
    expect(verifyApiKey(undefined, KEY)).toBe('missing');
    expect(verifyApiKey('', KEY)).toBe('missing');
    expect(verifyApiKey([], KEY)).toBe('missing');
  });

  it('returns ok for the exact key', () => {
    expect(verifyApiKey(KEY, KEY)).toBe('ok');
  });

  it('returns invalid for a different key, including prefixes and different lengths', () => {
    expect(verifyApiKey('wrong', KEY)).toBe('invalid');
    expect(verifyApiKey(KEY.slice(0, -1), KEY)).toBe('invalid');
    expect(verifyApiKey(`${KEY}x`, KEY)).toBe('invalid');
  });

  it('rejects a repeated header instead of picking one value', () => {
    expect(verifyApiKey([KEY, KEY], KEY)).toBe('invalid');
    expect(verifyApiKey([KEY], KEY)).toBe('ok');
  });
});
