/**
 * PDF 관련 타입 정의
 * Issue #98: 주문 목록 PDF 내보내기
 */

/**
 * PDF 테이블 행 데이터
 */
export interface PdfTableRow {
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
 * PDF 생성 옵션
 */
export interface PdfOptions {
  /** 문서 제목 */
  title?: string;
  /** 생성 일시 포함 여부 */
  includeTimestamp?: boolean;
  /** 필터 조건 문자열 */
  filterDescription?: string;
  /** 페이지 방향 */
  pageOrientation?: 'portrait' | 'landscape';
  /** 페이지 크기 */
  pageSize?: 'A4' | 'LETTER';
}
