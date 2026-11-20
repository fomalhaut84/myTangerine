/**
 * Python CLI vs TypeScript 출력 비교 스크립트
 *
 * 샘플 데이터로 Python LabelFormatter와 TypeScript LabelFormatter의
 * 출력을 비교하여 동일성을 검증합니다.
 */

import { LabelFormatter } from '../src/formatters/label-formatter.js';
import { sheetRowToOrder, type SheetRow } from '../src/types/order.js';
import { Config } from '../src/config/config.js';

// 샘플 설정 (Python 버전과 동일한 가격 사용)
const config = new Config({
  SPREADSHEET_NAME: '감귤 주문서(응답)',
  DEFAULT_SENDER_NAME: '기본발송인',
  DEFAULT_SENDER_ADDRESS: '제주도 제주시 정실3길 113',
  DEFAULT_SENDER_PHONE: '010-6395-0618',
});

// 단가는 주문 원문(폼 문구)에서 읽는다 — 코드 가격표는 #317 에서 지웠다(라벨에는 금액이 없다)

// 샘플 데이터 (Python CLI와 동일한 시나리오)
const sampleSheetRows: SheetRow[] = [
  {
    '타임스탬프': '2024. 12. 5. 오전 9:30:15',
    '비고': '',
    '보내는분 성함': '김철수',
    '보내는분 주소 (도로명 주소로 부탁드려요)': '서울시 강남구 테헤란로 123',
    '보내는분 연락처 (핸드폰번호)': '01012345678',
    '받으실분 성함': '이영희',
    '받으실분 주소 (도로명 주소로 부탁드려요)': '서울시 송파구 올림픽로 456',
    '받으실분 연락처 (핸드폰번호)': '01098765432',
    '상품 선택': '감귤 5kg',
    '5kg 수량': '2',
    '10kg 수량': '',
    _rowNumber: 2,
  },
  {
    '타임스탬프': '2024. 12. 5. 오후 2:15:30',
    '비고': '',
    '보내는분 성함': '박민수',
    '보내는분 주소 (도로명 주소로 부탁드려요)': '부산시 해운대구 해변로 789',
    '보내는분 연락처 (핸드폰번호)': '01055556666',
    '받으실분 성함': '최지훈',
    '받으실분 주소 (도로명 주소로 부탁드려요)': '대구시 수성구 범어로 321',
    '받으실분 연락처 (핸드폰번호)': '01077778888',
    '상품 선택': '감귤 10kg',
    '5kg 수량': '',
    '10kg 수량': 1,
    _rowNumber: 3,
  },
  {
    '타임스탬프': '2024. 12. 6. 오전 10:00:00',
    '비고': '',
    '보내는분 성함': '김철수',
    '보내는분 주소 (도로명 주소로 부탁드려요)': '서울시 강남구 테헤란로 123',
    '보내는분 연락처 (핸드폰번호)': '01012345678',
    '받으실분 성함': '정미선',
    '받으실분 주소 (도로명 주소로 부탁드려요)': '인천시 남동구 논현로 555',
    '받으실분 연락처 (핸드폰번호)': '01099990000',
    '상품 선택': '감귤 5kg',
    '5kg 수량': '3',
    '10kg 수량': '',
    _rowNumber: 4,
  },
];

// TypeScript 버전 실행
console.log('='.repeat(80));
console.log('TypeScript LabelFormatter 출력');
console.log('='.repeat(80));
console.log();

const formatter = new LabelFormatter(config);
const orders = sampleSheetRows.map((row) => sheetRowToOrder(row, config));
const output = formatter.formatLabels(orders);

console.log(output);

console.log();
console.log('='.repeat(80));
console.log('출력 검증');
console.log('='.repeat(80));
console.log();

// 기본 검증
const checks = [
  {
    name: '날짜 헤더 (2024-12-05)',
    passed: output.includes('=== 2024-12-05 ==='),
  },
  {
    name: '날짜 헤더 (2024-12-06)',
    passed: output.includes('=== 2024-12-06 ==='),
  },
  {
    name: '발송인: 김철수',
    passed: output.includes('서울시 강남구 테헤란로 123 김철수 010-1234-5678'),
  },
  {
    name: '발송인: 박민수',
    passed: output.includes('부산시 해운대구 해변로 789 박민수 010-5555-6666'),
  },
  {
    name: '수취인: 이영희',
    passed: output.includes('서울시 송파구 올림픽로 456 이영희 010-9876-5432'),
  },
  {
    name: '수취인: 최지훈',
    passed: output.includes('대구시 수성구 범어로 321 최지훈 010-7777-8888'),
  },
  {
    name: '수취인: 정미선',
    passed: output.includes('인천시 남동구 논현로 555 정미선 010-9999-0000'),
  },
  {
    name: '5kg 상품 (2박스)',
    passed: output.includes('5kg / 2박스'),
  },
  {
    name: '10kg 상품 (1박스)',
    passed: output.includes('10kg / 1박스'),
  },
  {
    name: '5kg 상품 (3박스)',
    passed: output.includes('5kg / 3박스'),
  },
  {
    name: '5kg 합계',
    passed: output.includes('5kg 주문: 5박스 (100,000원)'),
  },
  {
    name: '10kg 합계',
    passed: output.includes('10kg 주문: 1박스 (35,000원)'),
  },
  {
    name: '총 주문금액',
    passed: output.includes('총 주문금액: 135,000원'),
  },
];

let passedCount = 0;
checks.forEach((check) => {
  const status = check.passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${status}: ${check.name}`);
  if (check.passed) passedCount++;
});

console.log();
console.log(`결과: ${passedCount}/${checks.length} 검증 통과`);
console.log();

if (passedCount === checks.length) {
  console.log('🎉 모든 검증 통과! TypeScript 버전이 Python 버전과 동일한 출력을 생성합니다.');
  process.exit(0);
} else {
  console.error('⚠️  일부 검증 실패. 출력을 확인하세요.');
  process.exit(1);
}
