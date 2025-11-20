import { type Env, loadEnv } from './env.js';
import type { Sender } from '../types/order.js';

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

  constructor() {
    this.env = loadEnv();
  }

  /** Google 인증 파일 경로 */
  get credentialsPath(): string {
    return this.env.GOOGLE_CREDENTIALS_PATH;
  }

  /** 스프레드시트 이름 */
  get spreadsheetName(): string {
    return this.env.SPREADSHEET_NAME;
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
