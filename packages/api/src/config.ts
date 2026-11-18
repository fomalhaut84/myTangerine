/**
 * API 서버 설정 및 환경 변수 검증
 */

import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { findProjectRoot } from '@mytangerine/core';

// Monorepo 프로젝트 루트에서 .env 파일 로드
const projectRoot = findProjectRoot();
const envPath = join(projectRoot, '.env');
dotenvConfig({ path: envPath });

/**
 * 환경 변수 스키마 (Zod)
 */
const EnvSchema = z.object({
  PORT: z
    .string()
    .default('3001')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /**
   * 교차 오리진 허용 목록 (#218) — 비어 있음(기본)=허용 안 함 · `*`=개발 전용 · 쉼표 목록.
   * 해석은 cors-options.ts
   */
  CORS_ORIGIN: z.string().default(''),
  /**
   * 서버 키 (#218) — 헬스체크 외 모든 요청의 x-api-key. 운영에서는 필수.
   * 개발에서 비워 두면 기동은 되지만 요청이 503 으로 거부된다(fail-closed).
   */
  API_SECRET_KEY: z.string().optional(),
  /** 분당 요청 상한 (#218) — 웹 서버 경유라 사실상 전역 상한 */
  RATE_LIMIT_MAX: z
    .string()
    .default('600')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),
  /**
   * 데이터 소스 모드 (Phase 2.3)
   * - sheets: Google Sheets만 사용 (기본값, 기존 방식)
   * - database: PostgreSQL만 사용
   * - hybrid: DB 우선 읽기, DB+Sheets 동시 쓰기
   */
  DATA_SOURCE: z.enum(['sheets', 'database', 'hybrid']).default('sheets'),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production') return;
  if (!env.API_SECRET_KEY) {
    ctx.addIssue({
      code: 'custom',
      path: ['API_SECRET_KEY'],
      message: '운영(NODE_ENV=production)에서는 API_SECRET_KEY 가 필요합니다',
    });
  }
  if (env.CORS_ORIGIN.trim() === '*') {
    ctx.addIssue({
      code: 'custom',
      path: ['CORS_ORIGIN'],
      message: "운영에서는 CORS_ORIGIN='*' 를 쓸 수 없습니다 — 비우거나 허용 오리진을 적으세요",
    });
  }
});

/**
 * 파싱 및 검증된 환경 변수
 */
export type Env = z.infer<typeof EnvSchema>;

/**
 * 환경 변수 로드 및 검증
 */
export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('❌ 환경 변수 검증 실패:');
    console.error(z.prettifyError(parsed.error));
    process.exit(1);
  }

  return parsed.data;
}

/**
 * Package.json 메타데이터
 */
export interface PackageMetadata {
  name: string;
  version: string;
  description: string;
}

/**
 * Package.json 읽기
 */
export async function loadPackageMetadata(): Promise<PackageMetadata> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const packageJsonPath = join(__dirname, '../package.json');

  const content = await readFile(packageJsonPath, 'utf-8');
  const pkg = JSON.parse(content);

  return {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
  };
}
