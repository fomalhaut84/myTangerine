/**
 * PrismaClient 생성 — Prisma 7 드라이버 어댑터 (#241)
 *
 * v7 은 Rust 쿼리 엔진이 없고 @prisma/adapter-pg(node-pg)로 접속한다. client 가 .env 를 스스로 읽지 않으므로
 * 접속 문자열을 명시적으로 넘긴다. api · sync-service · core 가 모두 이 함수로 만든다.
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/** 접속 타임아웃 — v6 기본값(5초)과 같게. pg 의 기본값은 0(무제한)이다 */
export const DB_CONNECT_TIMEOUT_MS = 5_000;

export interface CreatePrismaClientOptions {
  /** 없으면 process.env.DATABASE_URL */
  databaseUrl?: string;
  log?: Prisma.LogLevel[];
}

export function createPrismaClient(options: CreatePrismaClientOptions = {}): PrismaClient {
  const connectionString = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!connectionString) {
    // pg 는 접속 문자열이 없으면 PG* 기본값(로컬 · 현재 사용자)으로 붙는다 — 엉뚱한 DB 에 조용히 붙지 않게 막는다
    throw new Error('DATABASE_URL is not set — cannot create the database client');
  }
  const adapter = new PrismaPg({ connectionString, connectionTimeoutMillis: DB_CONNECT_TIMEOUT_MS });
  return new PrismaClient({ adapter, ...(options.log && { log: options.log }) });
}
