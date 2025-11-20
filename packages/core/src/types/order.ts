/**
 * 주문 관련 타입 정의
 */

/** 상품 타입 */
export type ProductType = '5kg' | '10kg';

/** 주문 상태 */
export type OrderStatus = 'pending' | 'confirmed';

/** 사람 정보 (발송인/수취인) */
export interface Person {
  /** 이름 */
  name: string;
  /** 주소 */
  address: string;
  /** 전화번호 */
  phone: string;
}

/** 발송인 정보 */
export type Sender = Person;

/** 수취인 정보 */
export type Recipient = Person;

/** 주문 정보 */
export interface Order {
  /** 주문 ID (행 번호) */
  id?: string;
  /** 타임스탬프 */
  timestamp: Date;
  /** 발송인 */
  sender: Sender;
  /** 수취인 */
  recipient: Recipient;
  /** 상품 타입 */
  product: ProductType;
  /** 수량 */
  quantity: number;
  /** 주문 상태 */
  status: OrderStatus;
}

/** 주문 요약 */
export interface OrderSummary {
  /** 5kg 박스 정보 */
  '5kg': {
    /** 박스 수 */
    count: number;
    /** 금액 */
    amount: number;
  };
  /** 10kg 박스 정보 */
  '10kg': {
    /** 박스 수 */
    count: number;
    /** 금액 */
    amount: number;
  };
  /** 총 금액 */
  total: number;
}

/** 스프레드시트 원본 데이터 (한국어 컬럼명) */
export interface SheetRow {
  타임스탬프: string;
  '보내는분 성함': string;
  '보내는분 주소 (도로명 주소로 부탁드려요)': string;
  '보내는분 연락처 (핸드폰번호)': string;
  '받으실분 성함': string;
  '받으실분 주소 (도로명 주소로 부탁드려요)': string;
  '받으실분 연락처 (핸드폰번호)': string;
  '상품 선택': string;
  '5kg 수량'?: string;
  '10kg 수량'?: string;
  비고?: string;
}
