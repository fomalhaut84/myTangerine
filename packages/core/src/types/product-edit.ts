/**
 * 웹 상품 · 수량 수정 (#282)
 *
 * 상품 선택 오류(검증 실패) 주문을 웹에서 바로잡는다 — 시트는 사람이 고치지 않는다(hybrid 정본 = DB · S-10).
 * DB 와 시트가 같은 값을 쓰도록 수정 값 → 시트 칸(`상품 선택` + 카탈로그의 수량 칸 전부)을 여기서 한 번만 정한다.
 *
 * - 수정할 수 있는 상품은 5kg · 10kg 뿐이다(비상품은 2023 이후 주문 없음 · 사용자 2026-11-20)
 * - 상품 · 수량 칸은 카탈로그(`catalog/products.ts`)가 정본이다 — 상품이 늘면 카탈로그에만 더한다 (#313)
 * - `상품 선택` 에는 **단가가 든 폼 문구**를 쓴다(#317) — 상품이 그대로면 지금 원문, 바뀌면 같은 시즌 다른 주문의 폼 문구.
 *   예전(#282)에는 종류만(`10kg`) 써서 단가가 사라졌다. 최초 입력값은 DB `original_input` 에 남는다
 * - 다른 상품의 수량 칸은 `''` 로 비운다 — `'0'` 을 쓰면 수량 해석(`extractQuantity`)이 5kg 칸을 먼저 읽어 0 이 된다
 */

import {
  editableProductsOf,
  findProduct,
  quantityColumnsOf,
  resolveProductSelection,
  QUANTITY_STORAGE_FIELD,
  type EditableProductType,
  type QuantityColumn,
  type QuantityStorageField,
} from '../catalog/products.js';
import { parseUnitPrice } from '../catalog/form-selection.js';

/** 웹에서 고를 수 있는 상품 — 정본은 catalog/products.ts 의 `editable` (#313) */
export const EDITABLE_PRODUCT_TYPES = editableProductsOf() as readonly EditableProductType[];
export type { EditableProductType };

/** 수량을 쓰는 시트 칸 — 시트 컬럼명은 외부 계약이다(data-safety S-7) · 카탈로그 순서 */
export const QUANTITY_COLUMNS = quantityColumnsOf() as readonly QuantityColumn[];

/** 상품 → 수량 칸 — 카탈로그에서 만든다 */
export const PRODUCT_QUANTITY_COLUMN: Readonly<Record<EditableProductType, QuantityColumn>> = Object.fromEntries(
  EDITABLE_PRODUCT_TYPES.map((id) => [id, findProduct(id)?.quantityColumn])
) as Record<EditableProductType, QuantityColumn>;

/** 수량 상한 — 오타(예: 100 → 1000) 방지 */
export const MAX_EDIT_QUANTITY = 999;

export interface ProductEditInput {
  productType?: EditableProductType;
  quantity?: number;
  /**
   * 바꿀 상품의 **폼 문구**(예: `10kg (38,000 / box)`) — 같은 시즌 다른 주문 원문에서 호출하는 쪽이 찾는다(#317 `pickSeasonSelection`).
   * 단가는 폼에서만 정한다: 앱이 단가를 만들지 않는다
   */
  seasonSelection?: string | null;
  /**
   * 호출하는 쪽(API)이 이미 확정한 `상품 선택` 원문 — 주면 DB · 시트가 각자의 지금 원문 대신 이 값을 그대로 쓴다.
   * hybrid 에서 두 저장소의 원문이 달라도 같은 단가가 남게 한다(#322 · PR #321 Codex P2)
   */
  resolvedSelection?: string | null;
}

/** 지금 주문의 상품 · 수량 — productType 은 검증 결과(오류면 null) */
export interface ProductEditCurrent {
  productType: string | null;
  quantity: number;
  /** 지금 `상품 선택` 원문 — 상품이 그대로면 단가가 든 이 원문을 유지한다(#317) */
  productSelection?: string | null;
}

export type ProductEditCells = Record<'상품 선택' | QuantityColumn, string>;

export interface ResolvedProductEdit {
  productType: EditableProductType;
  quantity: number;
  cells: ProductEditCells;
}

/** 수정 값이 틀렸다 — API 는 400 으로 답한다 */
export class ProductEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductEditError';
  }
}

export function isEditableProductType(value: unknown): value is EditableProductType {
  return typeof value === 'string' && (EDITABLE_PRODUCT_TYPES as readonly string[]).includes(value);
}

function assertQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_EDIT_QUANTITY) {
    throw new ProductEditError(`수량은 1 ~ ${MAX_EDIT_QUANTITY} 사이 정수여야 합니다.`);
  }
}

function isFormSelectionOf(selection: string | null | undefined, productType: EditableProductType): selection is string {
  return !!selection && resolveProductSelection(selection) === productType && parseUnitPrice(selection) !== null;
}

/**
 * `상품 선택` 에 쓸 원문 (#317) — 단가가 든 폼 문구여야 한다.
 * 확정 원문(resolvedSelection)이 있으면 그것, 아니면 상품이 그대로일 때 지금 원문, 바뀌면 같은 시즌 폼 문구.
 * 셋 다 없으면 단가를 지어내지 않고 거절한다
 */
function resolveSelectionText(current: ProductEditCurrent, input: ProductEditInput, productType: EditableProductType): string {
  if (isFormSelectionOf(input.resolvedSelection, productType)) return input.resolvedSelection;
  if (isFormSelectionOf(current.productSelection, productType)) return current.productSelection;
  if (isFormSelectionOf(input.seasonSelection, productType)) return input.seasonSelection;
  throw new ProductEditError(
    `이번 시즌 ${productType} 주문의 폼 단가를 찾지 못했습니다 — 같은 시즌에 ${productType} 주문이 있어야 바꿀 수 있습니다. ` +
      '지금 바꿔야 하면 이 주문을 삭제하고 폼으로 다시 주문해 주세요.'
  );
}

/**
 * 수정 값을 최종 상품 · 수량 · 시트 칸으로 바꾼다.
 * @returns 상품 · 수량 수정이 아니면 null
 * @throws ProductEditError 수정할 수 없는 상품 · 잘못된 수량 · 상품을 정할 수 없음(지금 상품이 오류인데 수량만 줌) · 폼 단가를 찾지 못함
 */
export function resolveProductEdit(current: ProductEditCurrent, input: ProductEditInput): ResolvedProductEdit | null {
  if (input.productType === undefined && input.quantity === undefined) return null;

  if (input.productType !== undefined && !isEditableProductType(input.productType)) {
    throw new ProductEditError(`수정할 수 있는 상품은 ${EDITABLE_PRODUCT_TYPES.join(' · ')} 입니다.`);
  }

  const productType = input.productType ?? (isEditableProductType(current.productType) ? current.productType : null);
  if (!productType) {
    throw new ProductEditError(`지금 상품을 알 수 없습니다 — 상품(${EDITABLE_PRODUCT_TYPES.join(' · ')})을 함께 지정해 주세요.`);
  }

  const quantity = input.quantity ?? current.quantity;
  assertQuantity(quantity);

  const quantityCells = Object.fromEntries(QUANTITY_COLUMNS.map((column) => [column, ''])) as Record<QuantityColumn, string>;
  const cells: ProductEditCells = {
    '상품 선택': resolveSelectionText(current, input, productType),
    ...quantityCells,
    [PRODUCT_QUANTITY_COLUMN[productType]]: String(quantity),
  };

  return { productType, quantity, cells };
}

/** DB(Order) 에 쓰는 상품 · 수량 필드 — 화면 · PDF · 통계가 다시 해석하는 칸과 검증 오류를 함께 맞춘다 */
export interface ProductEditOrderFields {
  productSelection: string;
  productType: EditableProductType;
  quantity5kg: string;
  quantity10kg: string;
  quantity: number;
  validationError: null;
}

export function productEditToOrderFields(edit: ResolvedProductEdit): ProductEditOrderFields {
  const quantityFields = Object.fromEntries(
    QUANTITY_COLUMNS.map((column) => [QUANTITY_STORAGE_FIELD[column], edit.cells[column]])
  ) as Record<QuantityStorageField, string>;
  return {
    productSelection: edit.cells['상품 선택'],
    productType: edit.productType,
    ...quantityFields,
    quantity: edit.quantity,
    validationError: null,
  };
}
