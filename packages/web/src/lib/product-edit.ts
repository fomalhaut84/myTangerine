/**
 * 웹 상품 · 수량 수정 (#282)
 *
 * 상품 선택 오류(검증 실패) 주문을 주문 상세에서 바로잡는다. 서버(PATCH /api/orders/:rowNumber)가 최종 판정하고,
 * 화면은 고칠 수 있는 주문에만 입력을 보여 주고 바뀐 값만 보낸다.
 *
 * 상품 목록의 정본은 core `EDITABLE_PRODUCT_TYPES` 다(web 은 core 를 import 하지 않는다).
 * 상품이 바뀌면 둘을 함께 고친다 — 다르면 서버가 400 으로 거절한다.
 */
import type { Order, OrderStatus, OrderType } from '@/types/api';

export const EDITABLE_PRODUCTS = ['5kg', '10kg'] as const;
export type EditableProduct = (typeof EDITABLE_PRODUCTS)[number];

/** 서버 MAX_EDIT_QUANTITY 와 같다 */
export const MAX_EDIT_QUANTITY = 999;

const PRODUCT_EDITABLE_STATUSES: readonly OrderStatus[] = ['신규주문', '입금확인'];

type ProductEditOrder = Pick<Order, 'productType' | 'quantity' | 'validationError'> & {
  status: OrderStatus;
  orderType: OrderType;
  isDeleted?: boolean;
};

export interface ProductEditForm {
  productType?: EditableProduct;
  quantity?: number;
}

export type ProductEditPayloadResult =
  | { ok: true; payload: ProductEditForm }
  | { ok: false; error: string };

export function isEditableProduct(value: unknown): value is EditableProduct {
  return typeof value === 'string' && (EDITABLE_PRODUCTS as readonly string[]).includes(value);
}

/** 상품 · 수량을 고칠 수 있는 주문 — 신규주문 · 입금확인 · 배송사고 아님 · 삭제 아님 */
export function canEditProduct(order: ProductEditOrder): boolean {
  return PRODUCT_EDITABLE_STATUSES.includes(order.status) && order.orderType !== 'claim' && !order.isDeleted;
}

/** 수정 폼의 처음 값 — 오류 주문은 상품을 비워 두어 고르게 한다 */
export function initialProductEditForm(order: ProductEditOrder): ProductEditForm {
  return {
    productType: !order.validationError && isEditableProduct(order.productType) ? order.productType : undefined,
    quantity: order.quantity,
  };
}

/**
 * 보낼 값 — 바뀐 값만. 오류 주문은 상품을 골라야 하고, 고르면 상품 · 수량을 함께 보낸다.
 */
export function buildProductEditPayload(order: ProductEditOrder, form: ProductEditForm): ProductEditPayloadResult {
  const quantity = form.quantity ?? order.quantity;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_EDIT_QUANTITY) {
    return { ok: false, error: `수량은 1 ~ ${MAX_EDIT_QUANTITY} 사이 정수여야 합니다.` };
  }

  const isBroken = Boolean(order.validationError) || !isEditableProduct(order.productType);
  if (isBroken) {
    if (!form.productType) {
      return { ok: false, error: `상품(${EDITABLE_PRODUCTS.join(' · ')})을 골라 주세요.` };
    }
    return { ok: true, payload: { productType: form.productType, quantity } };
  }

  return {
    ok: true,
    payload: {
      ...(form.productType && form.productType !== order.productType ? { productType: form.productType } : {}),
      ...(quantity !== order.quantity ? { quantity } : {}),
    },
  };
}
