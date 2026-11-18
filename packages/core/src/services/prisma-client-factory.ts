/**
 * PrismaClient 생성 — Prisma 7 드라이버 어댑터 (#241)
 *
 * v7 은 Rust 쿼리 엔진이 없고 @prisma/adapter-pg(node-pg)로 접속한다. client 가 .env 를 스스로 읽지 않으므로
 * 접속 문자열을 명시적으로 넘긴다. api · sync-service · core 가 모두 이 함수로 만든다.
 *
 * v6 와 다른 점(node-pg):
 * - 풀 크기는 프로세스마다 10(pg 기본). URL 의 Prisma 전용 파라미터 `connection_limit` · `pool_timeout` 은 무시된다
 * - `?schema=` 도 pg 는 읽지 않는다 → 여기서 꺼내 어댑터 옵션으로 넘긴다
 * - `sslmode=prefer|require` 는 평문으로 물러나지 않고 TLS 를 요구한다(운영은 localhost — 런북 점검 A)
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * 연결 대기 상한 — pg 는 이 값을 **접속**과 **풀에서 연결을 기다리는 시간** 둘 다에 쓴다.
 * v6 는 접속 5초 · 풀 대기 10초였으므로, 몰릴 때 새로 실패하지 않도록 큰 쪽(10초)에 맞춘다. pg 기본값은 0(무제한)
 */
export const DB_CONNECT_TIMEOUT_MS = 10_000;

export interface CreatePrismaClientOptions {
  /** 없으면 process.env.DATABASE_URL */
  databaseUrl?: string;
  log?: Prisma.LogLevel[];
  /** 풀·연결 오류(유휴 연결 끊김 등) 보고 — 메시지만 넘긴다(접속 문자열을 남기지 않는다). 기본은 console.error */
  onError?: (message: string) => void;
}

/** 접속 문자열의 `?schema=` (없거나 해석 불가면 undefined → DB 의 search_path) */
export function schemaFromUrl(connectionString: string): string | undefined {
  try {
    return new URL(connectionString).searchParams.get('schema') || undefined;
  } catch {
    return undefined;
  }
}

export function createPrismaClient(options: CreatePrismaClientOptions = {}): PrismaClient {
  const connectionString = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!connectionString) {
    // pg 는 접속 문자열이 없으면 PG* 기본값(로컬 · 현재 사용자)으로 붙는다 — 엉뚱한 DB 에 조용히 붙지 않게 막는다
    throw new Error('DATABASE_URL is not set — cannot create the database client (저장소 루트 .env 를 읽었는지 확인)');
  }
  const report = options.onError ?? ((message: string) => console.error(message));
  const schema = schemaFromUrl(connectionString);
  const adapter = new PrismaPg(
    { connectionString, connectionTimeoutMillis: DB_CONNECT_TIMEOUT_MS },
    {
      ...(schema && { schema }),
      onPoolError: (err) => report(`[prisma] pool error: ${err.message}`),
      onConnectionError: (err) => report(`[prisma] connection error: ${err.message}`),
    }
  );
  return new PrismaClient({ adapter, ...(options.log && { log: options.log }) });
}
