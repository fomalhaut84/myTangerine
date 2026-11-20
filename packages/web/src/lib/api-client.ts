/**
 * API 클라이언트
 * @mytangerine/api 서버와 통신
 */

import ky from 'ky';
import { toast } from 'sonner';
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
import type { SyncResponse } from './sync-result';
import type { EditableProduct } from './product-edit';

/**
 * 브라우저는 API 서버를 직접 부르지 않는다 (#220).
 * 같은 오리진의 웹 서버 경유 경로(`/bff/api/...`)로 부르고, 웹 서버가 세션을 확인한 뒤
 * 서버 키를 붙여 내부 API 로 전달한다(`src/app/bff/[...path]/route.ts`).
 */
export const BFF_BASE = '/bff';

/** 세션이 끝났으면 로그인 화면으로 — 돌아올 경로를 next 로 넘긴다 */
export function redirectToLogin(): void {
  if (typeof window === 'undefined') return;
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

/**
 * 쓰기 응답의 경고를 보여 준다 (#197) — hybrid 모드에서 DB 에는 저장됐지만 시트 반영이 실패한 경우.
 * 성공 토스트와 별개로 경고 토스트를 띄운다. 본문을 읽을 수 없으면 조용히 넘어간다(응답 자체는 정상).
 */
export async function notifyWriteWarnings(method: string, response: Response): Promise<void> {
  if (method === 'GET' || method === 'HEAD' || !response.ok) return;
  if (!(response.headers.get('content-type') ?? '').includes('application/json')) return;
  try {
    const body: unknown = await response.clone().json();
    const warnings = (body as { warnings?: unknown } | null)?.warnings;
    if (Array.isArray(warnings)) {
      for (const warning of warnings) {
        if (typeof warning === 'string' && warning) toast.warning(warning, { duration: 10_000 });
      }
    }
  } catch {
    // 본문이 JSON 이 아니면 경고도 없다
  }
}

/** fetch 응답 공통 처리 — 401 이면 로그인 화면으로 보낸다 */
export function handleUnauthorized(response: Response): void {
  if (response.status === 401) redirectToLogin();
}

/**
 * 쓰기가 409 로 거절되면 서버 문구를 보여 준다 (#258) — 시트 행 순서가 DB 와 맞지 않아 아무것도 저장하지 않은 경우.
 * 화면들은 실패 시 일반 문구("… 중 오류가 발생했습니다")만 띄우므로, 원인과 "변경 없음"을 알 수 있게 따로 띄운다.
 */
export async function notifyWriteConflict(method: string, response: Response): Promise<void> {
  if (method === 'GET' || method === 'HEAD' || response.status !== 409) return;
  if (!(response.headers.get('content-type') ?? '').includes('application/json')) return;
  try {
    const body: unknown = await response.clone().json();
    const message = (body as { error?: unknown } | null)?.error;
    if (typeof message === 'string' && message) toast.error(message, { duration: 15_000 });
  } catch {
    // 본문이 JSON 이 아니면 문구도 없다
  }
}

export const api = ky.create({
  prefixUrl: BFF_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
  retry: {
    limit: 2,
    methods: ['get'],
    statusCodes: [408, 413, 429, 500, 502, 503, 504],
  },
  hooks: {
    afterResponse: [
      async (request, _options, response) => {
        handleUnauthorized(response);
        await notifyWriteWarnings(request.method, response);
        await notifyWriteConflict(request.method, response);
      },
    ],
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
 * #282: productType · quantity 는 신규주문 · 입금확인 주문에서만(서버가 판정 · lib/product-edit)
 */
export interface OrderUpdateData {
  sender?: { name?: string; phone?: string; address?: string };
  recipient?: { name?: string; phone?: string; address?: string };
  productType?: EditableProduct;
  quantity?: number;
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
 * 웹 서버 경유(BFF) — 서버 키는 웹 서버에서만 붙는다. 응답 상한 5분도 웹 서버가 처리(`lib/bff/forward.ts`)
 * #279: 응답에 충돌 · 정지 정보가 있다 — 표시 판정은 `lib/sync-result.ts`
 */
export async function syncData(): Promise<SyncResponse> {
  const response = await fetch(`${BFF_BASE}/api/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  handleUnauthorized(response);
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
