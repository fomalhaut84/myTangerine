/**
 * 연도별 상품 가격 회귀 (#313)
 *
 * 카탈로그로 옮기기 전 값과 연도 대체 규칙을 고정한다 — 통계 금액(api `calculateOrderAmount`)이 이 값을 쓴다.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../env.js', () => ({
  loadEnv: () => ({
    SPREADSHEET_NAME: 'test',
    NODE_ENV: 'test',
    DEFAULT_SENDER_NAME: '기본',
    DEFAULT_SENDER_ADDRESS: '주소',
    DEFAULT_SENDER_PHONE: '010-0000-0000',
  }),
  findProjectRoot: () => '/tmp',
}));

const { Config } = await import('../config.js');

const EXPECTED_PRICES = {
  '2020': { '10kg': 26000 },
  '2021': { '비상품': 17000, '10kg': 26000 },
  '2022': { '비상품': 18000, '10kg': 28000 },
  '2023': { '10kg': 30000 },
  '2024': { '5kg': 20000, '10kg': 35000 },
  '2025': { '5kg': 23000, '10kg': 38000 },
};

describe('Config 상품 가격 (#313 회귀)', () => {
  const config = new Config();

  it('연도별 가격표 값이 그대로다', () => {
    expect(config.productPrices).toEqual(EXPECTED_PRICES);
  });

  it.each(Object.entries(EXPECTED_PRICES))('%s 년은 그 해 가격', (year, prices) => {
    expect(config.getPricesForYear(Number(year))).toEqual(prices);
  });

  it('표에 없는 해는 가장 가까운 이전 해 가격 (2026 → 2025)', () => {
    expect(config.getPricesForYear(2026)).toEqual(EXPECTED_PRICES['2025']);
    expect(config.getPricesForYear(2030)).toEqual(EXPECTED_PRICES['2025']);
  });

  it('표보다 이른 해는 가장 오래된 해 가격 (2019 → 2020)', () => {
    expect(config.getPricesForYear(2019)).toEqual(EXPECTED_PRICES['2020']);
  });

  it('필수 시트 칸에 상품 · 수량 칸이 있다', () => {
    expect(config.requiredColumns).toEqual(
      expect.arrayContaining(['상품 선택', '5kg 수량', '10kg 수량'])
    );
  });
});
