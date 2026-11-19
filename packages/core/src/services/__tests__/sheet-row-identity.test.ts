/**
 * 시트 행 ↔ DB 주문 정체성 (#257) — 순수 함수
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeTimestampRaw,
  isSameOrder,
  buildSheetIdentityIndex,
  appearsAtOtherRow,
} from '../sheet-row-identity.js';
import { parseKoreanTimestamp } from '../../types/order.js';

const RAW = '2026. 11. 19. 오전 10:26:32';

describe('normalizeTimestampRaw', () => {
  it('점·공백 표기 차이를 지운다', () => {
    expect(normalizeTimestampRaw('2026. 11. 19 오전 10:26:32')).toBe(normalizeTimestampRaw(RAW));
    expect(normalizeTimestampRaw(undefined)).toBe('');
  });
});

describe('isSameOrder', () => {
  const existing = { timestamp: parseKoreanTimestamp(RAW), timestampRaw: RAW };

  it('원문이 같으면 같은 주문 — 해석한 시각이 달라도(시간대 차이)', () => {
    expect(isSameOrder({ timestamp: new Date(0), timestampRaw: RAW }, '2026. 11. 19 오전 10:26:32')).toBe(true);
  });

  it('원문이 달라도 시각이 같으면 같은 주문', () => {
    expect(isSameOrder({ ...existing, timestampRaw: 'legacy-format' }, RAW)).toBe(true);
  });

  it('원문도 시각도 다르면 다른 주문', () => {
    expect(isSameOrder(existing, '2026. 1. 7 오후 7:49:40')).toBe(false);
  });

  it('시트 값이 비었거나 읽을 수 없으면 판정하지 않는다(같은 주문)', () => {
    expect(isSameOrder(existing, '')).toBe(true);
    expect(isSameOrder(existing, undefined)).toBe(true);
    expect(isSameOrder(existing, '잘못된 값')).toBe(true);
  });
});

describe('buildSheetIdentityIndex · appearsAtOtherRow', () => {
  const index = buildSheetIdentityIndex([
    { _rowNumber: 391, 타임스탬프: RAW },
    { _rowNumber: 393, 타임스탬프: '2026. 1. 7 오후 7:49:40' },
    { _rowNumber: 394, 타임스탬프: '' },
  ]);

  it('다른 행에 같은 주문이 있으면 true · 같은 행뿐이면 false', () => {
    expect(appearsAtOtherRow(index, '2026. 1. 7. 오후 7:49:40', 391)).toBe(true);
    expect(appearsAtOtherRow(index, RAW, 391)).toBe(false);
  });

  it('시트에 없거나 원문이 비면 false', () => {
    expect(appearsAtOtherRow(index, '2025. 1. 1 오전 1:00:00', 391)).toBe(false);
    expect(appearsAtOtherRow(index, null, 391)).toBe(false);
  });
});
