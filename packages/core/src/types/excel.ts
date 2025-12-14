/**
 * Excel 관련 타입 정의
 * Issue #113: 주문 목록 Excel 내보내기
 */

/**
 * Excel 테이블 행 데이터
 * PDF 테이블 행과 동일한 구조 사용
 */
export interface ExcelTableRow {
  번호: number;
  보내는분_성명: string;
  보내는분_전화번호: string;
  받는분_주소: string;
  받는분_성명: string;
  받는분_전화번호: string;
  수량: number;
  품목명: string;
}

/**
 * Excel 생성 옵션
 */
export interface ExcelOptions {
  /** 문서 제목 */
  title?: string;
  /** 시트 이름 */
  sheetName?: string;
  /** 생성 일시 포함 여부 */
  includeTimestamp?: boolean;
  /** 필터 조건 문자열 */
  filterDescription?: string;
}
