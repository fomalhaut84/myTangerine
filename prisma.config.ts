/**
 * Prisma CLI 설정 (#241 · Prisma 7)
 *
 * - v7 CLI 는 .env 를 자동으로 읽지 않는다 → 저장소 루트 .env 를 여기서 읽는다(CLI 는 루트에서 실행: postinstall · prisma:* 스크립트)
 * - 접속 주소는 스키마가 아니라 여기 둔다. generate 는 DB 가 필요 없으므로 비어 있어도 실패하지 않게 한다
 *   (migrate status · deploy 는 비어 있으면 Prisma 가 오류로 멈춘다)
 * - 정본 스키마·마이그레이션은 루트 prisma/ 하나 (#208 · .claude/rules/data-safety.md)
 */
import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'prisma/config';

loadDotenv({ quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
