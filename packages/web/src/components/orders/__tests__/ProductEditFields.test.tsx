/**
 * 상품 · 수량 수정 입력 (#282)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProductEditFields } from '../ProductEditFields';

describe('ProductEditFields', () => {
  it('오류 주문은 상품이 비어 있고 안내를 보여 준다 — 고르면 상품을 넘긴다', () => {
    const onChange = vi.fn();
    render(<ProductEditFields form={{ quantity: 2 }} onChange={onChange} hasValidationError />);
    const select = screen.getByLabelText('상품 타입') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(screen.getByText(/상품 선택 오류/)).toBeTruthy();
    fireEvent.change(select, { target: { value: '10kg' } });
    expect(onChange).toHaveBeenCalledWith({ quantity: 2, productType: '10kg' });
  });

  it('고를 수 있는 상품은 5kg · 10kg', () => {
    render(<ProductEditFields form={{}} onChange={vi.fn()} hasValidationError={false} />);
    const values = Array.from((screen.getByLabelText('상품 타입') as HTMLSelectElement).options).map((o) => o.value);
    expect(values).toEqual(['', '5kg', '10kg']);
  });

  it('수량을 바꾸면 숫자로 넘기고, 비우면 undefined', () => {
    const onChange = vi.fn();
    render(<ProductEditFields form={{ productType: '5kg', quantity: 1 }} onChange={onChange} hasValidationError={false} />);
    const input = screen.getByLabelText('수량(상자)');
    fireEvent.change(input, { target: { value: '3' } });
    expect(onChange).toHaveBeenLastCalledWith({ productType: '5kg', quantity: 3 });
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({ productType: '5kg', quantity: undefined });
  });
});
