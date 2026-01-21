/**
 * API 클라이언트
 * @mytangerine/api 서버와 통신
 */

import ky from 'ky';
import type {
  OrdersResponse,
  OrderResponse,
  SummaryResponse,
  ConfirmResponse,
  MonthlyStatsResponse,
  GroupedLabelsResponse,
  StatsResponse,
  StatsQueryParams,
} from '@/types/api';

/**
 * API Base URL 검증
 * - 환경 변수가 있으면 사용
 * - 없으면 localhost:3001 기본값 사용 (빌드 시 및 개발 시)
 * - Production 런타임에서 환경 변수 설정 권장
 * - Trailing slash는 자동으로 제거 (이중 슬래시 방지)
 *
 * Note: API 서버는 3001번 포트를 사용합니다 (Next.js 웹 서버는 3000번)
 */
function getApiBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_BASE_URL;

  // 환경 변수가 있으면 사용 (trailing slash 제거)
  if (url) {
    return url.replace(/\/+$/, '');
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

// API Base URL을 다른 모듈에서 사용할 수 있도록 export
export { apiBaseUrl };

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
 * 주문 상태 필터 타입 (3단계 상태 지원)
 */
export type OrderStatusFilter = 'new' | 'pending_payment' | 'completed' | 'all';

/**
 * 주문 목록 조회
 * @param status - 'new' (신규), 'pending_payment' (입금확인), 'completed' (배송완료), 'all' (전체)
 */
export async function getOrders(status?: OrderStatusFilter): Promise<OrdersResponse> {
  const searchParams = status ? { status } : {};
  return api.get('api/orders', { searchParams }).json<OrdersResponse>();
}

/**
 * 특정 주문 조회
 * @param orderId - 주문 ID (sheetRowNumber 또는 DB ID)
 * @param idType - ID 유형 ('rowNumber' | 'dbId'), 기본값 'rowNumber'
 * Issue #155: claim 주문은 idType='dbId'로 조회
 */
export async function getOrder(orderId: number, idType?: 'rowNumber' | 'dbId'): Promise<OrderResponse> {
  const url = idType ? `api/orders/${orderId}?idType=${idType}` : `api/orders/${orderId}`;
  return api.get(url).json<OrderResponse>();
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
  return api.post('api/orders/confirm', { json: {} }).json<ConfirmResponse>();
}

/**
 * 개별 주문 확인 처리 (기존 호환성 유지)
 */
export async function confirmSingleOrder(rowNumber: number): Promise<{
  success: boolean;
  message: string;
}> {
  return api.post(`api/orders/${rowNumber}/confirm`, { json: {} }).json<{
    success: boolean;
    message: string;
  }>();
}

/**
 * 입금 확인 처리 (신규주문 → 입금확인)
 */
export async function confirmPayment(rowNumber: number): Promise<{
  success: boolean;
  message: string;
}> {
  return api.post(`api/orders/${rowNumber}/confirm-payment`, { json: {} }).json<{
    success: boolean;
    message: string;
  }>();
}

/**
 * 배송 완료 처리 (입금확인 → 배송완료)
 * @param orderId - 주문 ID (rowNumber 또는 dbId)
 * @param trackingNumber - 송장번호 (선택)
 * @param idType - ID 타입 (기본: rowNumber, claim 주문은 dbId 사용) - Issue #168
 */
export async function markDelivered(
  orderId: number,
  trackingNumber?: string,
  idType?: 'rowNumber' | 'dbId'
): Promise<{
  success: boolean;
  message: string;
}> {
  const searchParams = idType === 'dbId' ? `?idType=dbId` : '';
  return api.post(`api/orders/${orderId}/mark-delivered${searchParams}`, {
    json: trackingNumber ? { trackingNumber } : {}
  }).json<{
    success: boolean;
    message: string;
  }>();
}

/**
 * 주문 삭제 (Soft Delete)
 */
export async function deleteOrder(rowNumber: number): Promise<{
  success: boolean;
  message: string;
}> {
  return api.post(`api/orders/${rowNumber}/delete`, { json: {} }).json<{
    success: boolean;
    message: string;
  }>();
}

/**
 * 주문 복원 (Soft Delete 취소)
 */
export async function restoreOrder(rowNumber: number): Promise<{
  success: boolean;
  message: string;
}> {
  return api.post(`api/orders/${rowNumber}/restore`, { json: {} }).json<{
    success: boolean;
    message: string;
  }>();
}

/**
 * 주문 수정용 데이터 타입
 * Note: productType, quantity는 수정 불가 (Issue #136 정책)
 */
export interface OrderUpdateData {
  sender?: { name?: string; phone?: string; address?: string };
  recipient?: { name?: string; phone?: string; address?: string };
  orderType?: 'customer' | 'gift' | 'claim';
  trackingNumber?: string;
}

/**
 * 주문 정보 수정 (Issue #136)
 * @param rowNumber - 스프레드시트 행 번호
 * @param data - 수정할 필드들
 */
export async function updateOrder(rowNumber: number, data: OrderUpdateData): Promise<OrderResponse> {
  return api.patch(`api/orders/${rowNumber}`, { json: data }).json<OrderResponse>();
}

/**
 * 삭제된 주문 목록 조회
 */
export async function getDeletedOrders(): Promise<OrdersResponse> {
  return api.get('api/orders/deleted').json<OrdersResponse>();
}

/**
 * 라벨 텍스트 조회
 * @param status - 상태 필터
 */
export async function getLabels(status?: OrderStatusFilter): Promise<string> {
  const searchParams = status ? { status } : {};
  return api.get('api/labels', { searchParams }).text();
}

/**
 * 월별 주문 통계 조회
 */
export async function getMonthlyStats(): Promise<MonthlyStatsResponse> {
  return api.get('api/orders/stats/monthly').json<MonthlyStatsResponse>();
}

/**
 * 그룹화된 라벨 데이터 조회 (날짜/발신자별)
 * @param status - 상태 필터
 */
export async function getGroupedLabels(status?: OrderStatusFilter): Promise<GroupedLabelsResponse> {
  const searchParams = status ? { status } : {};
  return api.get('api/labels/grouped', { searchParams }).json<GroupedLabelsResponse>();
}

/**
 * 통합 통계 조회
 */
export async function getOrderStats(params?: StatsQueryParams): Promise<StatsResponse> {
  return api.get('api/orders/stats', { searchParams: params as Record<string, string> }).json<StatsResponse>();
}

/**
 * 수동 데이터 동기화 (Google Sheets → PostgreSQL)
 * Next.js API route를 통해 프록시 (보안을 위해 서버 사이드에서만 API 키 사용)
 */
export async function syncData(): Promise<{
  success: boolean;
  message: string;
  result: {
    total: number;
    success: number;
    failed: number;
    skipped: number;
    errors: Array<{ rowNumber: number; error: string }>;
  };
}> {
  // Next.js API route를 통해 프록시
  const response = await fetch('/api/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
    // 15분 타임아웃은 서버 사이드에서 처리
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Sync failed');
  }

  return response.json();
}

// =========================================
// Phase 2: 변경 이력 + 충돌 감지 API
// =========================================

/**
 * 변경 이력 항목 타입
 */
export interface ChangeLogEntry {
  id: number;
  changedAt: string;
  changedBy: 'web' | 'sync' | 'api';
  action: string;
  fieldChanges: Record<string, { old: unknown; new: unknown }>;
  previousVersion: number;
  newVersion: number;
  conflictDetected: boolean;
  conflictResolution: string | null;
}

/**
 * 변경 이력 응답 타입
 */
export interface OrderHistoryResponse {
  success: boolean;
  history: ChangeLogEntry[];
}

/**
 * 충돌 항목 타입
 */
export interface ConflictEntry {
  id: number;
  orderId: number;
  sheetRowNumber: number;
  changedAt: string;
  changedBy: string;
  action: string;
  fieldChanges: Record<string, { old: unknown; new: unknown }>;
  conflictResolution: string | null;
  order?: {
    id: number;
    recipientName: string | null;
    status: string | null;
  };
}

/**
 * 충돌 목록 응답 타입
 */
export interface ConflictsResponse {
  success: boolean;
  count: number;
  conflicts: ConflictEntry[];
}

/**
 * 주문 변경 이력 조회 (Phase 2)
 * @param rowNumber - 스프레드시트 행 번호
 * @param limit - 최대 결과 수
 * @param offset - 건너뛸 결과 수
 */
export async function getOrderHistory(
  rowNumber: number,
  limit?: number,
  offset?: number
): Promise<OrderHistoryResponse> {
  const searchParams: Record<string, string> = {};
  if (limit) searchParams.limit = String(limit);
  if (offset) searchParams.offset = String(offset);

  return api.get(`api/orders/${rowNumber}/history`, { searchParams }).json<OrderHistoryResponse>();
}

/**
 * 충돌 목록 조회 (Phase 2)
 * @param resolved - 해결 상태 필터 ('true', 'false', 'all')
 * @param limit - 최대 결과 수
 * @param offset - 건너뛸 결과 수
 */
export async function getConflicts(
  resolved?: 'true' | 'false' | 'all',
  limit?: number,
  offset?: number
): Promise<ConflictsResponse> {
  const searchParams: Record<string, string> = {};
  if (resolved) searchParams.resolved = resolved;
  if (limit) searchParams.limit = String(limit);
  if (offset) searchParams.offset = String(offset);

  return api.get('api/orders/conflicts', { searchParams }).json<ConflictsResponse>();
}

/**
 * 충돌 해결 (Phase 2)
 * @param conflictId - 충돌 로그 ID
 * @param resolution - 해결 방법
 */
export async function resolveConflict(
  conflictId: number,
  resolution: 'db_wins' | 'sheet_wins' | 'manual'
): Promise<{
  success: boolean;
  message: string;
  conflict: { id: number; conflictResolution: string };
}> {
  return api.post(`api/orders/conflicts/${conflictId}/resolve`, {
    json: { resolution }
  }).json<{
    success: boolean;
    message: string;
    conflict: { id: number; conflictResolution: string };
  }>();
}

/**
 * 배송사고 주문 생성 (Issue #152, #155)
 * 배송완료된 원본 주문을 복제하여 배송사고 유형의 신규 주문 생성
 * Issue #155: DB만 저장 (Sheets 저장 제거)
 * @param rowNumber - 원본 주문의 스프레드시트 행 번호
 */
export async function createClaimOrder(rowNumber: number): Promise<{
  success: boolean;
  data: {
    /** Issue #155: 생성된 배송사고 주문의 DB id */
    claimOrderId: number;
    /** 원본 주문의 sheetRowNumber */
    originalOrderId: number;
    message: string;
  };
}> {
  return api.post(`api/orders/${rowNumber}/claim`, { json: {} }).json<{
    success: boolean;
    data: {
      claimOrderId: number;
      originalOrderId: number;
      message: string;
    };
  }>();
}
