/**
 * 웹 상품 · 수량 수정 (#282)
 *
 * 상품 선택 오류(검증 실패) 주문을 웹에서 바로잡는다 — 시트는 사람이 고치지 않는다(hybrid 정본 = DB · S-10).
 * DB 와 시트가 같은 값을 쓰도록 수정 값 → 시트 칸 3개(`상품 선택` · `5kg 수량` · `10kg 수량`)를 여기서 한 번만 정한다.
 *
 * - 수정할 수 있는 상품은 5kg · 10kg 뿐이다(비상품은 2023 이후 주문 없음 · 사용자 2026-11-20)
 * - 상품 → 수량 칸은 PRODUCT_QUANTITY_COLUMN 표 하나다 — 상품이 늘면 표에만 더한다
 * - `상품 선택` 에는 상품 종류 그대로(`5kg` · `10kg`)를 쓴다 — 재조정(#231)이 쓰는 값과 같다. 폼 원문은 DB `original_input` 에 남는다
 * - 다른 상품의 수량 칸은 `''` 로 비운다 — `'0'` 을 쓰면 수량 해석(`extractQuantity`)이 5kg 칸을 먼저 읽어 0 이 된다
 */

/** 웹에서 고를 수 있는 상품 */
export const EDITABLE_PRODUCT_TYPES = ['5kg', '10kg'] as const;
export type EditableProductType = (typeof EDITABLE_PRODUCT_TYPES)[number];

/** 수량을 쓰는 시트 칸 — 시트 컬럼명은 외부 계약이다(data-safety S-7) */
export const QUANTITY_COLUMNS = ['5kg 수량', '10kg 수량'] as const;
type QuantityColumn = (typeof QUANTITY_COLUMNS)[number];

export const PRODUCT_QUANTITY_COLUMN: Readonly<Record<EditableProductType, QuantityColumn>> = {
  '5kg': '5kg 수량',
  '10kg': '10kg 수량',
};

/** 수량 상한 — 오타(예: 100 → 1000) 방지 */
export const MAX_EDIT_QUANTITY = 999;

export interface ProductEditInput {
  productType?: EditableProductType;
  quantity?: number;
}

/** 지금 주문의 상품 · 수량 — productType 은 검증 결과(오류면 null) */
export interface ProductEditCurrent {
  productType: string | null;
  quantity: number;
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

/**
 * 수정 값을 최종 상품 · 수량 · 시트 칸으로 바꾼다.
 * @returns 상품 · 수량 수정이 아니면 null
 * @throws ProductEditError 수정할 수 없는 상품 · 잘못된 수량 · 상품을 정할 수 없음(지금 상품이 오류인데 수량만 줌)
 */
export function resolveProductEdit(current: ProductEditCurrent, input: ProductEditInput): ResolvedProductEdit | null {
  if (input.productType === undefined && input.quantity === undefined) return null;

  if (input.productType !== undefined && !isEditableProductType(input.productType)) {
    throw new ProductEditError(`수정할 수 있는 상품은 ${EDITABLE_PRODUCT_TYPES.join(' · ')} 입니다.`);
  }

  const productType = input.productType ?? (isEditableProductType(current.productType) ? current.productType : null);
  if (!productType) {
    throw new ProductEditError('지금 상품을 알 수 없습니다 — 상품(5kg · 10kg)을 함께 지정해 주세요.');
  }

  const quantity = input.quantity ?? current.quantity;
  assertQuantity(quantity);

  const quantityCells = Object.fromEntries(QUANTITY_COLUMNS.map((column) => [column, ''])) as Record<QuantityColumn, string>;
  const cells: ProductEditCells = {
    '상품 선택': productType,
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
  return {
    productSelection: edit.cells['상품 선택'],
    productType: edit.productType,
    quantity5kg: edit.cells['5kg 수량'],
    quantity10kg: edit.cells['10kg 수량'],
    quantity: edit.quantity,
    validationError: null,
  };
}
