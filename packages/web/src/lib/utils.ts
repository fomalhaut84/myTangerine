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
