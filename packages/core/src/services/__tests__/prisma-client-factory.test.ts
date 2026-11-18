/**
 * createPrismaClient — Prisma 7 드라이버 어댑터로 client 만들기 (#241)
 *
 * v7 은 Rust 쿼리 엔진이 없어 @prisma/adapter-pg 가 필수다. 접속 문자열은 더 이상 client 가 .env 에서
 * 스스로 읽지 않으므로 여기서 명시적으로 넘긴다. DB 에 접속하지 않는다(생성자만 · S-4).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const adapterArgs: unknown[] = [];
vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: class {
    constructor(config: unknown) {
      adapterArgs.push(config);
    }
  },
}));

const clientArgs: unknown[] = [];
vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    constructor(options: unknown) {
      clientArgs.push(options);
    }
  },
}));

import { createPrismaClient, DB_CONNECT_TIMEOUT_MS } from '../prisma-client-factory.js';

const URL = 'postgresql://user:password@localhost:5432/never-connected';

describe('createPrismaClient (#241)', () => {
  const original = process.env.DATABASE_URL;

  beforeEach(() => {
    adapterArgs.length = 0;
    clientArgs.length = 0;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  });

  it('builds the pg adapter from DATABASE_URL with the v6 connect timeout', () => {
    process.env.DATABASE_URL = URL;
    createPrismaClient();
    expect(adapterArgs).toEqual([{ connectionString: URL, connectionTimeoutMillis: DB_CONNECT_TIMEOUT_MS }]);
    expect(DB_CONNECT_TIMEOUT_MS).toBe(5_000);
    expect(clientArgs[0]).toEqual({ adapter: expect.any(Object) });
  });

  it('passes log levels through', () => {
    createPrismaClient({ databaseUrl: URL, log: ['error'] });
    expect(clientArgs[0]).toEqual({ adapter: expect.any(Object), log: ['error'] });
  });

  it('prefers an explicit databaseUrl over the environment', () => {
    process.env.DATABASE_URL = 'postgresql://other/db';
    createPrismaClient({ databaseUrl: URL });
    expect(adapterArgs[0]).toMatchObject({ connectionString: URL });
  });

  // pg 는 접속 문자열이 없으면 PG* 기본값(로컬 · 현재 사용자)으로 붙는다 — 엉뚱한 DB 에 조용히 붙지 않게 막는다
  it.each([undefined, ''])('fails fast when DATABASE_URL is %j', (value) => {
    if (value === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = value;
    expect(() => createPrismaClient()).toThrow('DATABASE_URL');
    expect(adapterArgs).toHaveLength(0);
  });
});
