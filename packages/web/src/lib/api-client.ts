/**
 * API 클라이언트
 * @mytangerine/api 서버와 통신
 */

import ky from 'ky';
import type {
  OrdersResponse,
  SummaryResponse,
  ConfirmResponse,
} from '@/types/api';

/**
 * API Base URL 검증
 * - 환경 변수가 있으면 사용
 * - 없으면 localhost:3001 기본값 사용 (빌드 시 및 개발 시)
 * - Production 런타임에서 환경 변수 설정 권장
 *
 * Note: API 서버는 3001번 포트를 사용합니다 (Next.js 웹 서버는 3000번)
 */
function getApiBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_BASE_URL;

  // 환경 변수가 있으면 사용
  if (url) {
    return url;
  }

  // 없으면 localhost:3001 기본값 사용 (브라우저에서만 경고)
  if (typeof window !== 'undefined') {
    console.warn(
      '[API Client] NEXT_PUBLIC_API_BASE_URL not set, using http://localhost:3001'
    );
  }
  return 'http://localhost:3001';
}

const apiBaseUrl = getApiBaseUrl();

export const api = ky.create({
  prefixUrl: apiBaseUrl,
  headers: {
    'Content-Type': 'application/json',
    'x-app-client': 'web',
  },
  timeout: 30000,
  retry: {
    limit: 2,
    methods: ['get'],
    statusCodes: [408, 413, 429, 500, 502, 503, 504],
  },
});

/**
 * 주문 목록 조회
 */
export async function getOrders(): Promise<OrdersResponse> {
  return api.get('api/orders').json<OrdersResponse>();
}

/**
 * 주문 요약 조회
 */
export async function getOrdersSummary(): Promise<SummaryResponse> {
  return api.get('api/orders/summary').json<SummaryResponse>();
}

/**
 * 주문 확인 처리
 */
export async function confirmOrders(): Promise<ConfirmResponse> {
  return api.post('api/orders/confirm').json<ConfirmResponse>();
}

/**
 * 라벨 텍스트 조회
 */
export async function getLabels(): Promise<string> {
  return api.get('api/labels').text();
}
