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
 */
export type OrderType = 'customer' | 'gift';

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
 */
export type StatsScope = 'completed' | 'new' | 'all';
export type StatsRange = '6m' | '12m' | 'custom';
export type StatsGrouping = 'monthly';
export type StatsMetric = 'quantity' | 'amount';
export type OrderTypeFilter = 'all' | 'customer' | 'gift';

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
