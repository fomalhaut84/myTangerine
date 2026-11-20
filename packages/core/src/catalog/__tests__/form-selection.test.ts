import { describe, it, expect } from 'vitest';
import { parseUnitPrice, pickSeasonSelection, seasonOf } from '../form-selection.js';

describe('parseUnitPrice', () => {
  it.each([
    ['10kg (38,000 / box)', 38000],
    ['5kg (23,000 / box)', 23000],
    ['비상품 (17,000 / box)', 17000],
    ['10kg (30,000/box)', 30000],
    ['10kg ( 26000 / BOX )', 26000],
  ])('"%s" → %d', (selection, price) => {
    expect(parseUnitPrice(selection)).toBe(price);
  });

  it.each(['10kg', '', '10kg (무료 / box)', '10kg (0 / box)', '10kg 38,000원'])('"%s" → null', (selection) => {
    expect(parseUnitPrice(selection)).toBeNull();
  });

  it('null · undefined → null', () => {
    expect(parseUnitPrice(null)).toBeNull();
    expect(parseUnitPrice(undefined)).toBeNull();
  });
});

describe('seasonOf — 7월 경계', () => {
  it.each([
    ['2025-11-25T10:00:00', 2025],
    ['2025-12-31T23:00:00', 2025],
    ['2026-01-15T10:00:00', 2025],
    ['2026-06-30T10:00:00', 2025],
    ['2026-07-01T00:00:00', 2026],
  ])('%s → %d 시즌', (date, season) => {
    expect(seasonOf(new Date(date))).toBe(season);
  });
});

describe('pickSeasonSelection', () => {
  const at = (iso: string) => new Date(iso);
  const candidates = [
    { productSelection: '10kg (30,000 / box)', timestamp: at('2024-01-08T10:00:00') }, // 2023 시즌
    { productSelection: '10kg (35,000 / box)', timestamp: at('2024-11-28T10:00:00') }, // 2024 시즌
    { productSelection: '10kg (35,000 / box)', timestamp: at('2024-12-20T10:00:00') },
    { productSelection: '5kg (20,000 / box)', timestamp: at('2024-12-01T10:00:00') },
    { productSelection: '10kg', timestamp: at('2024-12-02T10:00:00') }, // 단가 없는 원문
  ];

  it('같은 시즌 · 같은 상품 · 단가 있는 문구', () => {
    expect(pickSeasonSelection(candidates, '10kg', at('2025-01-05T10:00:00'))).toBe('10kg (35,000 / box)');
  });

  it('해를 넘긴 1월 주문은 지난해 시작 시즌 문구 (2024-01 → 2023 시즌)', () => {
    expect(pickSeasonSelection(candidates, '10kg', at('2024-01-10T10:00:00'))).toBe('10kg (30,000 / box)');
  });

  it('시즌 중 폼 가격이 바뀌었으면 시각이 가장 가까운 문구', () => {
    const changed = [
      { productSelection: '10kg (35,000 / box)', timestamp: at('2024-11-28T10:00:00') },
      { productSelection: '10kg (36,000 / box)', timestamp: at('2024-12-20T10:00:00') },
    ];
    expect(pickSeasonSelection(changed, '10kg', at('2024-12-01T10:00:00'))).toBe('10kg (35,000 / box)');
    expect(pickSeasonSelection(changed, '10kg', at('2024-12-18T10:00:00'))).toBe('10kg (36,000 / box)');
  });

  it('그 시즌에 그 상품 주문이 없으면 null — 단가를 지어내지 않는다', () => {
    expect(pickSeasonSelection(candidates, '5kg', at('2023-12-10T10:00:00'))).toBeNull();
    expect(pickSeasonSelection([], '10kg', at('2024-12-10T10:00:00'))).toBeNull();
  });

  it('타임스탬프를 읽지 못한 후보는 건너뛴다', () => {
    expect(
      pickSeasonSelection([{ productSelection: '10kg (35,000 / box)', timestamp: new Date('x') }], '10kg', at('2024-12-10T10:00:00'))
    ).toBeNull();
  });
});
