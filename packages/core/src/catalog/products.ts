/**
 * 상품 카탈로그 (#296 · #313)
 *
 * 상품 지식(`상품 선택` 해석 · 수량 칸 · 웹 수정 가능 여부 · 라벨 요약 표시)의 정본이다.
 * 폼에 상품이 생기거나 바뀌면 **여기 한 곳**에 항목을 더한다 — 해석 · 수량 · 라벨 · 웹 수정이 함께 따라온다.
 * 단가는 코드가 아니라 주문 원문(폼 문구)에 있다 — `./form-selection.ts` (#317).
 *
 * - 카탈로그에 없는 상품은 무효다(검증 오류 주문). "아무 kg 나 받는다"가 아니다
 * - 수량 칸 이름은 시트 컬럼 = 외부 계약이다(data-safety S-7) — 새 칸은 시트 쪽 작업과 함께
 * - 순서가 뜻을 가진다: 수량 칸을 읽는 순서 · 라벨 요약 순서가 카탈로그 순서다
 */

/** `상품 선택` 원문에서 상품을 알아보는 규칙 */
export type SelectionRule =
  /** 글자가 들어 있으면 이 상품 — 무게 규칙보다 먼저 본다 */
  | { readonly kind: 'includes'; readonly text: string }
  /** 단어 경계로 일치하면 이 상품(`15kg` 안의 `5kg` 는 아니다) — 여럿이면 원문에서 먼저 나온 것 */
  | { readonly kind: 'word'; readonly word: string };

export interface ProductDefinition {
  /** DB `product_type` · 시트에 쓰는 상품 종류 · 화면 표기 */
  readonly id: string;
  readonly selection: SelectionRule;
  /** 이 상품의 수량을 적는 시트 칸 — 없으면 수량 칸이 없는 상품 */
  readonly quantityColumn: string | null;
  /** 웹 주문 수정에서 고를 수 있는지 */
  readonly editable: boolean;
  /** 라벨 요약에 0박스여도 줄을 보일지 (아니면 있을 때만) */
  readonly alwaysInSummary: boolean;
}

export const PRODUCT_CATALOG = [
  // 비상품은 2023 이후 주문 없음 — 과거 주문 해석용으로 남기고 웹에서는 고르지 않는다(사용자 2026-11-20)
  { id: '비상품', selection: { kind: 'includes', text: '비상품' }, quantityColumn: null, editable: false, alwaysInSummary: false },
  { id: '5kg', selection: { kind: 'word', word: '5kg' }, quantityColumn: '5kg 수량', editable: true, alwaysInSummary: true },
  { id: '10kg', selection: { kind: 'word', word: '10kg' }, quantityColumn: '10kg 수량', editable: true, alwaysInSummary: true },
] as const satisfies readonly ProductDefinition[];

type CatalogEntry = (typeof PRODUCT_CATALOG)[number];

/** 상품 종류 */
export type ProductType = CatalogEntry['id'];
/** 웹에서 고를 수 있는 상품 */
/** 웹에서 고를 수 있는 상품 — 수량 칸이 있는 상품만 (수량 칸 없는 editable 상품은 타입에서 빠지고 아래 단언이 막는다) */
export type EditableProductType = Extract<CatalogEntry, { editable: true; quantityColumn: string }>['id'];
/** 수량 시트 칸 */
export type QuantityColumn = NonNullable<CatalogEntry['quantityColumn']>;

export type ProductCatalog = readonly ProductDefinition[];

/**
 * DB 에 수량 원문을 담는 칼럼 — 스키마가 상품별 칼럼이다(`quantity_5kg` · `quantity_10kg`).
 * 여기 없는 수량 칸의 원문은 DB `original_input` 에만 남는다(수량 해석값은 `quantity` 에 저장된다)
 */
export const QUANTITY_STORAGE_FIELD = {
  '5kg 수량': 'quantity5kg',
  '10kg 수량': 'quantity10kg',
} as const satisfies Readonly<Record<QuantityColumn, string>>;

export type QuantityStorageField = (typeof QUANTITY_STORAGE_FIELD)[QuantityColumn];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordIndex(selection: string, word: string): number {
  const match = new RegExp(`\\b${escapeRegExp(word)}\\b`).exec(selection);
  return match ? match.index : -1;
}

/**
 * `상품 선택` 원문 → 상품 id. 알아볼 수 없으면 null.
 * `includes` 규칙(카탈로그 순서)을 먼저 보고, 다음으로 `word` 규칙 중 원문에서 가장 먼저 나온 상품.
 */
export function resolveProductSelection(selection: string): ProductType | null;
export function resolveProductSelection(selection: string, catalog: ProductCatalog): string | null;
export function resolveProductSelection(selection: string, catalog: ProductCatalog = PRODUCT_CATALOG): string | null {
  const byText = catalog.find((p) => p.selection.kind === 'includes' && selection.includes(p.selection.text));
  if (byText) return byText.id;

  let found: { id: string; index: number } | null = null;
  for (const product of catalog) {
    if (product.selection.kind !== 'word') continue;
    const index = wordIndex(selection, product.selection.word);
    if (index >= 0 && (found === null || index < found.index)) {
      found = { id: product.id, index };
    }
  }
  return found ? found.id : null;
}

/** 수량 시트 칸 — 카탈로그 순서 */
export function quantityColumnsOf(catalog: ProductCatalog = PRODUCT_CATALOG): readonly string[] {
  return catalog.flatMap((p) => (p.quantityColumn ? [p.quantityColumn] : []));
}

/**
 * 웹에서 고를 수 있는 상품 id — 카탈로그 순서
 * @throws 수량 칸이 없는 상품을 editable 로 두면 — 웹 수정이 수량을 쓸 칸이 없다
 */
export function editableProductsOf(catalog: ProductCatalog = PRODUCT_CATALOG): readonly string[] {
  const editable = catalog.filter((p) => p.editable);
  const withoutColumn = editable.filter((p) => !p.quantityColumn).map((p) => p.id);
  if (withoutColumn.length > 0) {
    throw new Error(`상품 카탈로그 오류: 웹에서 고를 수 있는 상품에 수량 칸이 없습니다 — ${withoutColumn.join(', ')}`);
  }
  return editable.map((p) => p.id);
}

export function findProduct(id: string | null | undefined, catalog: ProductCatalog = PRODUCT_CATALOG): ProductDefinition | undefined {
  return id ? catalog.find((p) => p.id === id) : undefined;
}

function parseQuantityCell(value: unknown): number | null {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const match = String(value).match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

/**
 * 시트 행의 수량 — 수량 칸을 카탈로그 순서로 읽어 처음 숫자가 있는 칸의 값, 없으면 1(폼에서 비우면 1상자).
 * 주문 상품의 칸만 읽지 않는다 — 과거 주문 해석이 바뀌지 않게 예전 순서(5kg 칸 → 10kg 칸)를 그대로 둔다(#313)
 */
export function readQuantity(row: object, catalog: ProductCatalog = PRODUCT_CATALOG): number {
  const cells = row as Readonly<Record<string, unknown>>;
  for (const column of quantityColumnsOf(catalog)) {
    const quantity = parseQuantityCell(cells[column]);
    if (quantity !== null) return quantity;
  }
  return 1;
}

/** 시트 행 → DB 수량 원문 칼럼 (`String(값 || '')` — 예전 변환 그대로) */
export function quantityStorageFromRow(row: object): Record<QuantityStorageField, string> {
  const cells = row as Readonly<Record<string, unknown>>;
  return Object.fromEntries(
    Object.entries(QUANTITY_STORAGE_FIELD).map(([column, field]) => [field, String(cells[column] || '')])
  ) as Record<QuantityStorageField, string>;
}

/** DB 수량 원문 칼럼 → 시트 수량 칸 (값 그대로) */
export function quantityCellsFromStorage(
  order: Readonly<Record<QuantityStorageField, string>>
): Record<QuantityColumn, string> {
  return Object.fromEntries(
    Object.entries(QUANTITY_STORAGE_FIELD).map(([column, field]) => [column, order[field]])
  ) as Record<QuantityColumn, string>;
}
