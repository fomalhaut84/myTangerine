/**
 * 환경 변수 스키마 (zod 4) — #91
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { loadEnv } from '../config.js';

const KEYS = [
  'PORT',
  'HOST',
  'NODE_ENV',
  'LOG_LEVEL',
  'CORS_ORIGIN',
  'DATA_SOURCE',
  'API_SECRET_KEY',
  'RATE_LIMIT_MAX',
] as const;
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

  // #218 — 운영 보안 설정
  describe('security settings', () => {
    const exitSpy = () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      return vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('exit');
      }) as never);
    };

    it('defaults CORS_ORIGIN to empty (cross-origin disabled) and RATE_LIMIT_MAX to 600', () => {
      for (const k of KEYS) delete process.env[k];
      const env = loadEnv();
      expect(env.CORS_ORIGIN).toBe('');
      expect(env.RATE_LIMIT_MAX).toBe(600);
    });

    it('requires API_SECRET_KEY in production', () => {
      for (const k of KEYS) delete process.env[k];
      process.env.NODE_ENV = 'production';
      const exit = exitSpy();
      expect(() => loadEnv()).toThrow('exit');
      expect(exit).toHaveBeenCalledWith(1);
    });

    it('rejects the CORS wildcard in production', () => {
      for (const k of KEYS) delete process.env[k];
      process.env.NODE_ENV = 'production';
      process.env.API_SECRET_KEY = 'x'.repeat(40);
      process.env.CORS_ORIGIN = '*';
      exitSpy();
      expect(() => loadEnv()).toThrow('exit');
    });

    it('rejects the .env.example placeholder key in production', () => {
      for (const k of KEYS) delete process.env[k];
      process.env.NODE_ENV = 'production';
      process.env.API_SECRET_KEY = 'your_secret_key_here';
      exitSpy();
      expect(() => loadEnv()).toThrow('exit');
    });

    it('accepts a production config with a key and no CORS origin', () => {
      for (const k of KEYS) delete process.env[k];
      process.env.NODE_ENV = 'production';
      process.env.API_SECRET_KEY = 'x'.repeat(40);
      const env = loadEnv();
      expect(env.API_SECRET_KEY).toBe('x'.repeat(40));
    });

    it('allows a missing key outside production (routes then fail closed with 503)', () => {
      for (const k of KEYS) delete process.env[k];
      expect(loadEnv().API_SECRET_KEY).toBeUndefined();
    });
  });
});
