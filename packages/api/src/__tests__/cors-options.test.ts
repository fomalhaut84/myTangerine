/**
 * CORS 허용 목록 (#218)
 */

import { describe, it, expect } from 'vitest';
import { buildCorsOptions, CORS_METHODS } from '../cors-options.js';

describe('buildCorsOptions', () => {
  it('disables cross-origin access when no origin is configured', () => {
    expect(buildCorsOptions('').origin).toBe(false);
    expect(buildCorsOptions('  ').origin).toBe(false);
  });

  it('reflects any origin only for the explicit wildcard', () => {
    expect(buildCorsOptions('*').origin).toBe(true);
  });

  it('parses a comma separated allow list', () => {
    expect(buildCorsOptions('https://a.example.com, https://b.example.com').origin).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  it('keeps PATCH and DELETE in allowed methods', () => {
    expect(buildCorsOptions('https://a.example.com').methods).toEqual(CORS_METHODS);
  });
});
