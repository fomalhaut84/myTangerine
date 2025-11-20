import { z } from 'zod';
import { config as loadDotenv } from 'dotenv';
import path from 'path';

/**
 * 환경 변수 스키마
 */
const envSchema = z.object({
  /** Google Sheets API 인증 파일 경로 */
  GOOGLE_CREDENTIALS_PATH: z.string().default(path.join(process.cwd(), 'credentials.json')),

  /** 스프레드시트 이름 */
  SPREADSHEET_NAME: z.string().default('감귤 주문서(응답)'),

  /** 기본 발송인 주소 */
  DEFAULT_SENDER_ADDRESS: z.string(),

  /** 기본 발송인 이름 */
  DEFAULT_SENDER_NAME: z.string(),

  /** 기본 발송인 전화번호 */
  DEFAULT_SENDER_PHONE: z.string(),

  /** Node 환경 */
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * 환경 변수 로드 및 검증
 */
export function loadEnv(): Env {
  // .env 파일 로드
  loadDotenv();

  try {
    // 환경 변수 검증
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.errors.map((err) => err.path.join('.')).join(', ');
      throw new Error(
        `환경 변수 검증 실패:\n` +
          `누락된 변수: ${missingVars}\n\n` +
          `.env.example을 참고하여 .env 파일을 생성하고 필요한 값을 입력하세요.`
      );
    }
    throw error;
  }
}
