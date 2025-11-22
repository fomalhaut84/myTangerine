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
