import type { Config } from '../config/config.js';

/**
 * 발송인 정보
 */
export interface Sender {
  name: string;
  address: string;
  phone: string;
}

/**
 * 수취인 정보
 */
export interface Recipient {
  name: string;
  address: string;
  phone: string;
}

/**
 * 상품 타입
 */
export type ProductType = '5kg' | '10kg';

/**
 * 주문 상태 (한국어 원본 값)
 */
export type OrderStatus = '' | '확인' | string;

/**
 * 스프레드시트 원본 행 데이터
 * (Google Sheets에서 가져온 그대로의 데이터)
 */
export interface SheetRow {
  /** 타임스탬프 (문자열, 예: "2024. 12. 5. 오후 3:45:23") */
  '타임스탬프': string;

  /** 비고 (예: "", "확인") */
  '비고': string;

  /** 보내는분 성함 */
  '보내는분 성함': string;

  /** 보내는분 주소 */
  '보내는분 주소 (도로명 주소로 부탁드려요)': string;

  /** 보내는분 연락처 */
  '보내는분 연락처 (핸드폰번호)': string;

  /** 받으실분 성함 */
  '받으실분 성함': string;

  /** 받으실분 주소 */
  '받으실분 주소 (도로명 주소로 부탁드려요)': string;

  /** 받으실분 연락처 */
  '받으실분 연락처 (핸드폰번호)': string;

  /** 상품 선택 (예: "5kg", "10kg") */
  '상품 선택': string;

  /** 5kg 수량 */
  '5kg 수량': string | number;

  /** 10kg 수량 */
  '10kg 수량': string | number;

  /** 스프레드시트에서의 실제 행 번호 (헤더 행 포함, 1-based) */
  _rowNumber?: number;
}

/**
 * 처리된 주문 데이터
 * (비즈니스 로직에서 사용하기 쉽게 변환된 형태)
 */
export interface Order {
  /** 타임스탬프 (Date 객체로 파싱됨) */
  timestamp: Date;

  /** 타임스탬프 원본 문자열 */
  timestampRaw: string;

  /** 주문 상태 */
  status: OrderStatus;

  /** 발송인 정보 */
  sender: Sender;

  /** 수취인 정보 */
  recipient: Recipient;

  /** 선택한 상품 타입 */
  productType: ProductType;

  /** 주문 수량 */
  quantity: number;

  /** 스프레드시트에서의 실제 행 번호 */
  rowNumber: number;

  /** 원본 시트 행 데이터 (디버깅용) */
  _raw?: SheetRow;
}

/**
 * 한국어 타임스탬프 파싱 (Python 버전과 동일한 로직)
 * 예: "2024. 12. 5. 오후 3:45:23" -> Date
 */
export function parseKoreanTimestamp(timestampStr: string): Date {
  try {
    // 오전/오후를 AM/PM으로 변환
    const amPm = timestampStr.includes('오전') ? 'AM' : 'PM';
    let cleaned = timestampStr.replace('오전', 'AM').replace('오후', 'PM');

    // 점과 공백 제거하고 분리
    cleaned = cleaned.replace(/\./g, '').trim();
    const parts = cleaned.split(/\s+/);

    if (parts.length < 5) {
      throw new Error(`Invalid timestamp format: ${timestampStr}`);
    }

    const year = parts[0];
    const month = parts[1].padStart(2, '0');
    const day = parts[2].padStart(2, '0');
    const time = parts[4];

    // Date 객체 생성
    const [timePart] = time.split(':');
    let hour = parseInt(timePart, 10);
    const [, minute, second] = time.split(':');

    // 12시간 형식 -> 24시간 형식 변환
    if (amPm === 'PM' && hour !== 12) {
      hour += 12;
    } else if (amPm === 'AM' && hour === 12) {
      hour = 0;
    }

    return new Date(
      parseInt(year),
      parseInt(month) - 1, // JS의 월은 0부터 시작
      parseInt(day),
      hour,
      parseInt(minute),
      parseInt(second)
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse timestamp '${timestampStr}': ${message}`);
  }
}

/**
 * 수량 추출 (Python 버전의 get_quantity 로직)
 * 5kg 수량, 10kg 수량 중 값이 있는 것을 반환, 없으면 1
 */
export function extractQuantity(row: SheetRow): number {
  const qty5kg = row['5kg 수량'];
  const qty10kg = row['10kg 수량'];

  // 5kg 수량 확인
  if (qty5kg !== undefined && qty5kg !== null && String(qty5kg).trim() !== '') {
    const str = String(qty5kg);
    const match = str.match(/\d+/);
    if (match) {
      return parseInt(match[0], 10);
    }
  }

  // 10kg 수량 확인
  if (qty10kg !== undefined && qty10kg !== null && String(qty10kg).trim() !== '') {
    const str = String(qty10kg);
    const match = str.match(/\d+/);
    if (match) {
      return parseInt(match[0], 10);
    }
  }

  // 기본값
  return 1;
}

/**
 * 전화번호 포맷팅 (Python 버전의 format_phone_number 로직)
 * 010-XXXX-XXXX 형식으로 변환
 */
export function formatPhoneNumber(phone: string): string {
  if (!phone || phone.trim() === '') {
    return '';
  }

  // 숫자만 추출
  const numbersOnly = phone.replace(/\D/g, '');

  // 10자리이고 10으로 시작하면 앞에 0 추가
  let cleaned = numbersOnly;
  if (cleaned.length === 10 && cleaned.startsWith('10')) {
    cleaned = '0' + cleaned;
  }

  // 11자리이고 010으로 시작하면 포맷팅
  if (cleaned.length === 11 && cleaned.startsWith('010')) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`;
  }

  // 이미 올바른 형식이면 그대로 반환
  if (phone.replace(/-/g, '').length === 11 && phone.split('-').length === 3) {
    return phone;
  }

  // 그 외에는 원본 반환
  return phone;
}

/**
 * 문자열이 비어있는지 확인
 */
function isEmpty(value: string | undefined | null): boolean {
  return !value || value.trim() === '';
}

/**
 * SheetRow를 Order로 변환
 * Python 버전의 LabelFormatter와 동일하게 발송인 정보가 비어있으면 기본값 사용
 *
 * @param row - 스프레드시트 원본 행 데이터
 * @param config - (선택) Config 객체. 제공되면 발송인 정보가 비어있을 때 defaultSender로 대체
 */
export function sheetRowToOrder(row: SheetRow, config?: Config): Order {
  const timestamp = parseKoreanTimestamp(row['타임스탬프']);
  const quantity = extractQuantity(row);

  // 상품 타입 결정
  const productSelection = row['상품 선택'];
  let productType: ProductType;
  if (productSelection.includes('5kg')) {
    productType = '5kg';
  } else if (productSelection.includes('10kg')) {
    productType = '10kg';
  } else {
    throw new Error(`Unknown product type: ${productSelection}`);
  }

  // 발송인 정보 (config가 제공되고 필드가 비어있으면 기본값 사용)
  const senderName = row['보내는분 성함'];
  const senderAddress = row['보내는분 주소 (도로명 주소로 부탁드려요)'];
  const senderPhone = row['보내는분 연락처 (핸드폰번호)'];

  let sender: Sender;
  if (config) {
    // Config가 제공된 경우: 빈 필드를 defaultSender로 대체
    const defaultSender = config.defaultSender;
    sender = {
      name: isEmpty(senderName) ? defaultSender.name : senderName,
      address: isEmpty(senderAddress) ? defaultSender.address : senderAddress,
      phone: isEmpty(senderPhone) ? defaultSender.phone : formatPhoneNumber(senderPhone),
    };
  } else {
    // Config가 없는 경우: 원본 값 그대로 사용 (backward compatibility)
    sender = {
      name: senderName,
      address: senderAddress,
      phone: formatPhoneNumber(senderPhone),
    };
  }

  return {
    timestamp,
    timestampRaw: row['타임스탬프'],
    status: row['비고'] as OrderStatus,
    sender,
    recipient: {
      name: row['받으실분 성함'],
      address: row['받으실분 주소 (도로명 주소로 부탁드려요)'],
      phone: formatPhoneNumber(row['받으실분 연락처 (핸드폰번호)']),
    },
    productType,
    quantity,
    rowNumber: row._rowNumber || 0,
    _raw: row,
  };
}
