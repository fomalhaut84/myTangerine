import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * YYYY-MM-DD 형식의 날짜 문자열을 한국어 형식으로 변환
 * @param dateStr - "2025-01-01" 형식의 날짜 문자열
 * @returns "2025년 1월 1일" 형식의 문자열, 유효하지 않은 입력 시 원본 반환
 */
export function formatDateKorean(dateStr: string): string {
  // 유효하지 않은 입력 처리
  if (!dateStr || typeof dateStr !== 'string') {
    return dateStr ?? '';
  }

  // YYYY-MM-DD 형식 검증
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateStr)) {
    return dateStr; // 형식이 맞지 않으면 원본 반환
  }

  const [year, month, day] = dateStr.split('-').map(Number);

  // 숫자 변환 실패 처리
  if (isNaN(year) || isNaN(month) || isNaN(day)) {
    return dateStr;
  }

  return `${year}년 ${month}월 ${day}일`;
}

/**
 * 날짜 범위를 한국어 형식으로 변환
 * @param start - 시작 날짜 (YYYY-MM-DD)
 * @param end - 종료 날짜 (YYYY-MM-DD)
 * @returns "2025년 1월 1일 ~ 2025년 12월 31일" 형식의 문자열
 */
export function formatDateRangeKorean(start: string, end: string): string {
  return `${formatDateKorean(start)} ~ ${formatDateKorean(end)}`;
}

/**
 * 큰 숫자를 축약 표기로 변환 (한국식)
 * Issue #134: 금액 오버플로우 방지
 * @param value - 숫자 값
 * @param options - 포맷 옵션
 * @returns 축약된 문자열 (예: "1.2억", "340만")
 */
export function formatCompactNumber(
  value: number,
  options?: {
    /** 소수점 자리수 (기본: 1) */
    decimals?: number;
    /** 축약 임계값 (이 값 이상일 때만 축약, 기본: 10000) */
    threshold?: number;
  }
): string {
  const { decimals = 1, threshold = 10000 } = options ?? {};

  const absValue = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  // 임계값 미만이면 일반 포맷
  if (absValue < threshold) {
    return value.toLocaleString();
  }

  // 억 단위 (1억 이상 또는 반올림 시 1억 이상)
  // 반올림으로 단위가 넘어가는 케이스 처리 (예: 99,950,000 -> 1억)
  if (absValue >= 100000000) {
    const num = absValue / 100000000;
    return `${sign}${num.toFixed(decimals).replace(/\.0+$/, '')}억`;
  }

  // 만 단위일 때, 반올림 결과가 10000만이 되면 1억으로 표시
  if (absValue >= 10000) {
    const num = absValue / 10000;
    const rounded = parseFloat(num.toFixed(decimals));
    // 반올림 결과가 10000 이상이면 억 단위로 변환
    if (rounded >= 10000) {
      return `${sign}${(rounded / 10000).toFixed(decimals).replace(/\.0+$/, '')}억`;
    }
    return `${sign}${num.toFixed(decimals).replace(/\.0+$/, '')}만`;
  }

  return value.toLocaleString();
}
