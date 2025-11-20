import { type Env, loadEnv } from './env.js';
import type { Sender } from '../types/order.js';
import path from 'path';
import fs from 'fs';

/**
 * 상품 가격 정보
 */
export interface ProductPrices {
  '5kg': number;
  '10kg': number;
}

/**
 * 애플리케이션 설정
 */
export class Config {
  /** 환경 변수 */
  private readonly env: Env;

  /** 상품 가격 */
  public readonly productPrices: ProductPrices = {
    '5kg': 20000,
    '10kg': 35000,
  };

  /** 필수 스프레드시트 컬럼 */
  public readonly requiredColumns = [
    '타임스탬프',
    '비고',
    '보내는분 성함',
    '보내는분 주소 (도로명 주소로 부탁드려요)',
    '보내는분 연락처 (핸드폰번호)',
    '받으실분 성함',
    '받으실분 주소 (도로명 주소로 부탁드려요)',
    '받으실분 연락처 (핸드폰번호)',
    '상품 선택',
    '5kg 수량',
    '10kg 수량',
  ] as const;

  constructor() {
    this.env = loadEnv();
    this.validateCredentials();
  }

  /**
   * Google 인증 정보 유효성 검증
   */
  private validateCredentials(): void {
    const credPath = this.getCredentialsPath();

    if (credPath) {
      // 파일 경로가 제공된 경우 파일 존재 확인
      if (!fs.existsSync(credPath)) {
        throw new Error(
          `Google 인증 파일을 찾을 수 없습니다: ${credPath}\n` +
          `파일이 존재하는지 확인하거나 GOOGLE_CREDENTIALS_JSON을 사용하세요.`
        );
      }
    }
  }

  /**
   * 우선순위에 따라 credentials 파일 경로 반환
   */
  private getCredentialsPath(): string | null {
    if (this.env.GOOGLE_CREDENTIALS_PATH) {
      return path.resolve(this.env.GOOGLE_CREDENTIALS_PATH);
    }
    if (this.env.GOOGLE_CREDENTIALS_FILE) {
      return path.resolve(this.env.GOOGLE_CREDENTIALS_FILE);
    }
    return null;
  }

  /** Google 인증 파일 경로 */
  get credentialsPath(): string | undefined {
    return this.getCredentialsPath() || undefined;
  }

  /** Google 인증 JSON 문자열 */
  get credentialsJson(): string | undefined {
    return this.env.GOOGLE_CREDENTIALS_JSON;
  }

  /** 스프레드시트 이름 */
  get spreadsheetName(): string {
    return this.env.SPREADSHEET_NAME;
  }

  /** 스프레드시트 ID */
  get spreadsheetId(): string | undefined {
    return this.env.SPREADSHEET_ID;
  }

  /** 기본 발송인 정보 */
  get defaultSender(): Sender {
    return {
      name: this.env.DEFAULT_SENDER_NAME,
      address: this.env.DEFAULT_SENDER_ADDRESS,
      phone: this.env.DEFAULT_SENDER_PHONE,
    };
  }

  /** 개발 환경 여부 */
  get isDevelopment(): boolean {
    return this.env.NODE_ENV === 'development';
  }

  /** 프로덕션 환경 여부 */
  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  /** 테스트 환경 여부 */
  get isTest(): boolean {
    return this.env.NODE_ENV === 'test';
  }
}
