/**
 * 미디어 쿼리 훅
 * Issue #134: 반응형 차트를 위한 화면 크기 감지
 */

import { useState, useEffect } from 'react';

/**
 * 미디어 쿼리 매칭 여부를 반환하는 훅
 * @param query - CSS 미디어 쿼리 문자열 (예: '(max-width: 639px)')
 * @returns 미디어 쿼리 매칭 여부
 */
export function useMediaQuery(query: string): boolean {
  // SSR에서는 항상 false 반환 (기본값은 데스크탑으로 가정)
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    // 클라이언트에서만 실행
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia(query);

    // 초기값 설정
    setMatches(mediaQuery.matches);

    // 변경 감지 리스너
    const handler = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };

    // 이벤트 리스너 등록
    mediaQuery.addEventListener('change', handler);

    // 클린업
    return () => {
      mediaQuery.removeEventListener('change', handler);
    };
  }, [query]);

  return matches;
}
