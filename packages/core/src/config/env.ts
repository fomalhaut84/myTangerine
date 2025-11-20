import { z } from 'zod';
import { config as loadDotenv } from 'dotenv';
import path from 'path';

/**
 * 환경 변수 스키마
 */
const envSchema = z.object({
  /** Google Sheets API 인증 파일 경로 (우선순위 1) */
  GOOGLE_CREDENTIALS_PATH: z.string().optional(),

  /** Google Sheets API 인증 파일 경로 (Python 호환, 우선순위 2) */
  GOOGLE_CREDENTIALS_FILE: z.string().optional(),

  /** Google Sheets API 인증 JSON 문자열 (Python 호환, 우선순위 3) */
  GOOGLE_CREDENTIALS_JSON: z.string().optional(),

  /** 스프레드시트 이름 */
  SPREADSHEET_NAME: z.string().default('감귤 주문서(응답)'),

  /** 스프레드시트 ID (선택 사항, 이름 대신 사용 가능) */
  SPREADSHEET_ID: z.string().optional(),

  /** 기본 발송인 주소 */
  DEFAULT_SENDER_ADDRESS: z.string().min(1, '기본 발송인 주소는 필수입니다'),

  /** 기본 발송인 이름 */
  DEFAULT_SENDER_NAME: z.string().min(1, '기본 발송인 이름은 필수입니다'),

  /** 기본 발송인 전화번호 */
  DEFAULT_SENDER_PHONE: z.string().min(1, '기본 발송인 전화번호는 필수입니다'),

  /** Node 환경 */
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
}).refine(
  (data) => {
    // 최소 하나의 credentials 관련 환경변수가 있어야 함
    return data.GOOGLE_CREDENTIALS_PATH || data.GOOGLE_CREDENTIALS_FILE || data.GOOGLE_CREDENTIALS_JSON;
  },
  {
    message: 'GOOGLE_CREDENTIALS_PATH, GOOGLE_CREDENTIALS_FILE, GOOGLE_CREDENTIALS_JSON 중 최소 하나는 필수입니다',
  }
);

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
