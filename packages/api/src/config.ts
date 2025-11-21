/**
 * API 서버 설정 및 환경 변수 검증
 */

import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// .env 파일 로드
dotenvConfig();

/**
 * 환경 변수 스키마 (Zod)
 */
const EnvSchema = z.object({
  PORT: z
    .string()
    .default('3000')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGIN: z.string().default('*'),
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
    console.error(parsed.error.format());
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
