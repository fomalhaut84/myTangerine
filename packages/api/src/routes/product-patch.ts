/**
 * PATCH /api/orders/:rowNumber 의 상품 · 수량 수정 확인 (#282)
 *
 * - 신규주문 · 입금확인 주문만 · 배송사고(claim) 주문 제외
 * - 상품과 수량을 모두 정해서 넘긴다 — DB 와 시트가 각자의 "지금 값" 으로 해석해 서로 다른 칸을 쓰지 않게
 * - 상품 목록 · 수량 칸 매핑은 core `product-edit`(EDITABLE_PRODUCT_TYPES · PRODUCT_QUANTITY_COLUMN) 이 정본이다
 *
 * core 는 타입 선언 없이 소비되므로(dist 에 .d.ts 없음) 여기서 쓰는 모양을 정의한다.
 */
import { sheetRowToOrder, parseOrderType, resolveProductEdit, ProductEditError } from '@mytangerine/core';

/** 웹에서 고를 수 있는 상품 — 정본은 core EDITABLE_PRODUCT_TYPES (스키마 enum 은 그 값을 쓴다) */
export type EditableProductType = string;

export interface ProductPatchUpdates {
  productType?: EditableProductType;
  quantity?: number;
  [key: string]: unknown;
}

/** 상품 · 수량을 고칠 수 있는 상태 */
export const PRODUCT_EDITABLE_STATUSES: readonly string[] = ['신규주문', '입금확인'];

export type ProductPatchResult<T> =
  | { ok: true; updates: T }
  | { ok: false; statusCode: 400 | 409; error: string };

export function resolveProductPatch<T extends ProductPatchUpdates>(
  sheetRow: Record<string, unknown>,
  currentStatus: string,
  updates: T,
  config: unknown,
  /** #317 같은 시즌 폼 문구(`HybridDataService.findSeasonSelection`) — 상품을 바꿀 때 단가를 여기서 가져온다 */
  seasonSelection?: string | null
): ProductPatchResult<T> {
  if (updates.productType === undefined && updates.quantity === undefined) {
    return { ok: true, updates };
  }

  if (parseOrderType(sheetRow['주문유형'] as string | undefined) === 'claim') {
    return { ok: false, statusCode: 409, error: '배송사고 주문은 상품 · 수량을 수정할 수 없습니다.' };
  }
  if (!PRODUCT_EDITABLE_STATUSES.includes(currentStatus)) {
    return {
      ok: false,
      statusCode: 409,
      error: `상품 · 수량은 ${PRODUCT_EDITABLE_STATUSES.join(' · ')} 주문에서만 수정할 수 있습니다. (현재: ${currentStatus})`,
    };
  }

  const order = sheetRowToOrder(sheetRow, config);
  const current = {
    productType: order.validationError ? null : (order.productType as string | null),
    quantity: order.quantity as number,
    productSelection: String(sheetRow['상품 선택'] ?? ''),
  };

  try {
    const edit = resolveProductEdit(current, { productType: updates.productType, quantity: updates.quantity, seasonSelection });
    return {
      ok: true,
      updates: {
        ...updates,
        productType: edit.productType,
        quantity: edit.quantity,
        seasonSelection: seasonSelection ?? null,
        // #322 검증에서 확정한 원문 — hybrid 에서 DB · 시트의 지금 원문이 달라도 같은 값을 쓴다
        resolvedSelection: edit.cells['상품 선택'],
      },
    };
  } catch (error) {
    if (error instanceof ProductEditError) {
      return { ok: false, statusCode: 400, error: (error as Error).message };
    }
    throw error;
  }
}
