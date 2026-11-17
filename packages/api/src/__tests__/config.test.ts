/**
 * 환경 변수 스키마 (zod 4) — #91
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { loadEnv } from '../config.js';

const KEYS = ['PORT', 'HOST', 'NODE_ENV', 'LOG_LEVEL', 'CORS_ORIGIN', 'DATA_SOURCE'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

describe('loadEnv', () => {
  // 회귀: zod 4 는 .default() 가 변환을 건너뛸 수 있다 — PORT 기본값은 숫자여야 한다
  it('defaults PORT to the number 3001 and fills other defaults', () => {
    for (const k of KEYS) delete process.env[k];
    const env = loadEnv();
    expect(env.PORT).toBe(3001);
    expect(env.HOST).toBe('0.0.0.0');
    expect(env.NODE_ENV).toBe('development');
    expect(env.DATA_SOURCE).toBe('sheets');
  });

  it('parses PORT from string to number', () => {
    process.env.PORT = '4000';
    expect(loadEnv().PORT).toBe(4000);
  });

  it('exits on invalid values', () => {
    process.env.DATA_SOURCE = 'nope';
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => loadEnv()).toThrow('exit');
    expect(exit).toHaveBeenCalledWith(1);
  });
});
