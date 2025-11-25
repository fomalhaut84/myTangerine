/**
 * API 타입 정의
 * @mytangerine/api 서버의 응답 타입
 */

export interface PersonInfo {
  name: string;
  phone: string;
  address: string;
}

export interface Order {
  timestamp: string;
  timestampRaw: string;
  status: string;
  sender: PersonInfo;
  recipient: PersonInfo;
  productType: '5kg' | '10kg';
  quantity: number;
  rowNumber: number;
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
