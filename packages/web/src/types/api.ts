/**
 * API 타입 정의
 * @mytangerine/api 서버의 응답 타입
 */

export interface PersonInfo {
  name: string;
  phone: string;
  address: string;
}

/**
 * 주문 상태 (3단계)
 */
export type OrderStatus = '신규주문' | '입금확인' | '배송완료';

/**
 * 주문 유형
 * - customer: 판매 (매출 포함)
 * - gift: 선물 (매출 제외)
 * - claim: 배송사고 (매출 제외, 파손 보상) - Issue #152
 */
export type OrderType = 'customer' | 'gift' | 'claim';

export interface Order {
  timestamp: string;
  timestampRaw: string;
  status: OrderStatus;
  sender: PersonInfo;
  recipient: PersonInfo;
  productType: '비상품' | '5kg' | '10kg' | null;
  quantity: number;
  rowNumber: number;
  orderType: OrderType;
  validationError?: string;
  isDeleted: boolean;
  deletedAt?: string;
  trackingNumber?: string;
  ordererName?: string;
  ordererEmail?: string;
  /** Issue #155: 배송사고 원본 주문 참조 (claim 주문만 값 있음) */
  originalRowNumber?: number;
  /** Issue #165: DB ID (claim 주문 식별용) */
  dbId?: number;
  /** Issue #165: 주문 식별자 타입 (claim은 'dbId', 그 외는 'rowNumber') */
  idType?: 'rowNumber' | 'dbId';
}

export interface ProductSummary {
  count: number;
  amount: number;
}

export interface OrderSummary {
  '5kg': ProductSummary;
  '10kg': ProductSummary;
  total: number;
}

export interface OrdersResponse {
  success: boolean;
  count: number;
  orders: Order[];
}

export interface OrderResponse {
  success: boolean;
  order: Order;
}

export interface SummaryResponse {
  success: boolean;
  summary: OrderSummary;
}

export interface ConfirmResponse {
  success: boolean;
  message: string;
  confirmedCount: number;
}

export interface ErrorResponse {
  success: false;
  error: string;
  statusCode: number;
  timestamp: string;
}

export interface MonthlyStats {
  month: string; // YYYY-MM
  total5kg: number;
  total10kg: number;
  count: number;
}

export interface MonthlyStatsResponse {
  success: boolean;
  data: MonthlyStats[];
}

/**
 * 라벨 그룹 (날짜/발신자별)
 */
export interface LabelGroup {
  date: string;
  sender: {
    name: string;
    phone: string;
    address: string;
  };
  orders: Order[];
  summary: {
    '5kg': {
      count: number;
      amount: number;
    };
    '10kg': {
      count: number;
      amount: number;
    };
    total: number;
  };
}

export interface GroupedLabelsResponse {
  success: boolean;
  data: LabelGroup[];
}

/**
 * 통합 통계 타입
 * - 'completed': 배송완료 주문
 * - 'new': 신규주문
 * - 'pending_payment': 입금확인 주문 (Issue #130)
 * - 'all': 전체 주문
 * - 'peak_season': 성수기 주문 (10~2월) - Issue #142
 * - 'off_season': 비수기 주문 (3~9월) - Issue #142
 */
export type StatsScope = 'completed' | 'new' | 'pending_payment' | 'all' | 'peak_season' | 'off_season';
export type StatsRange = '6m' | '12m' | 'custom';
export type StatsGrouping = 'monthly';
export type StatsMetric = 'quantity' | 'amount';
export type OrderTypeFilter = 'all' | 'customer' | 'gift' | 'claim';

export interface StatsQueryParams {
  scope?: StatsScope;
  range?: StatsRange;
  grouping?: StatsGrouping;
  metric?: StatsMetric;
  orderType?: OrderTypeFilter;
  start?: string;
  end?: string;
}

export interface StatsSummary {
  orderCount: number;
  totalNonProductQty: number;
  total5kgQty: number;
  total10kgQty: number;
  totalNonProductAmount: number;
  total5kgAmount: number;
  total10kgAmount: number;
  totalRevenue: number;
  avgOrderAmount: number;
  dateRange: {
    start: string;
    end: string;
  };
}

export interface StatsSections {
  overall: StatsSummary;
  sales: StatsSummary;
  gifts: StatsSummary;
}

export interface MonthlyStatsSeries {
  period: string; // YYYY-MM
  totalNonProductQty: number;
  total5kgQty: number;
  total10kgQty: number;
  totalNonProductAmount: number;
  total5kgAmount: number;
  total10kgAmount: number;
  orderCount: number;
  avgOrderAmount: number;
  momGrowthPct: number | null;
}

export interface ProductTotals {
  productType: '비상품' | '5kg' | '10kg';
  quantity: number;
  amount: number;
  quantityPct: number;
  revenuePct: number;
}

export interface StatsResponse {
  success: true;
  filters: {
    scope: StatsScope;
    range: StatsRange;
    grouping: StatsGrouping;
    metric: StatsMetric;
    orderType: OrderTypeFilter;
  };
  summary: StatsSummary;
  sections: StatsSections;
  series: MonthlyStatsSeries[];
  totalsByProduct: ProductTotals[];
  meta: {
    generatedAt: string;
    currency: 'KRW';
  };
}

/**
 * KPI Alert 타입
 * Issue #112: 대시보드 KPI 알림 기능
 */
export type KPIAlertType = 'warning' | 'info' | 'success';

export interface KPIAlert {
  type: KPIAlertType;
  title: string;
  message: string;
}
