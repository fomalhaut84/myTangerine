'use client';

/**
 * 주문 상세 — 상품 · 수량 수정 입력 (#282)
 * 오류 주문은 상품을 비워 두고 고르게 한다. 판정 · 보낼 값은 `lib/product-edit` 가 정한다.
 */
import { EDITABLE_PRODUCTS, MAX_EDIT_QUANTITY, isEditableProduct, type ProductEditForm } from '@/lib/product-edit';

interface ProductEditFieldsProps {
  form: ProductEditForm;
  onChange: (form: ProductEditForm) => void;
  /** 지금 상품 선택이 검증 오류다 — 상품 입력을 강조한다 */
  hasValidationError: boolean;
}

const FIELD_CLASS =
  'w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500';

export function ProductEditFields({ form, onChange, hasValidationError }: ProductEditFieldsProps) {
  const productBorder = hasValidationError && !form.productType ? 'border-red-400' : 'border-gray-300';

  return (
    <>
      <div>
        <label htmlFor="edit-product-type" className="text-sm font-medium text-gray-500">
          상품 타입
        </label>
        <select
          id="edit-product-type"
          value={form.productType ?? ''}
          onChange={(e) =>
            onChange({ ...form, productType: isEditableProduct(e.target.value) ? e.target.value : undefined })
          }
          className={`mt-1 ${FIELD_CLASS} ${productBorder}`}
        >
          <option value="" disabled>
            상품을 고르세요
          </option>
          {EDITABLE_PRODUCTS.map((product) => (
            <option key={product} value={product}>
              {product}
            </option>
          ))}
        </select>
        {hasValidationError && (
          <p className="mt-1 text-xs text-red-600">상품 선택 오류 — 상품을 고르면 오류가 풀립니다.</p>
        )}
      </div>
      <div>
        <label htmlFor="edit-quantity" className="text-sm font-medium text-gray-500">
          수량(상자)
        </label>
        <input
          id="edit-quantity"
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_EDIT_QUANTITY}
          step={1}
          value={form.quantity ?? ''}
          onChange={(e) => onChange({ ...form, quantity: e.target.value === '' ? undefined : Number(e.target.value) })}
          className={`mt-1 ${FIELD_CLASS} border-gray-300`}
        />
      </div>
    </>
  );
}
