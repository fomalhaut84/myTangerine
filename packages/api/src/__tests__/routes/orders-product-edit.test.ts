/**
 * PATCH /api/orders/:rowNumber — 상품 · 수량 수정 (#282)
 *
 * 상품 선택 오류(검증 실패) 주문을 웹에서 바로잡는다. 신규주문 · 입금확인에서만, 5kg · 10kg 만.
 * 수정 값은 상품 · 수량을 모두 정해서 데이터 서비스에 넘긴다 — DB 와 시트가 서로 다른 "지금 값" 으로 해석하지 않게.
 * 시트 · DB 는 mock 이다(S-4).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestServer, AUTH_HEADERS } from '../helpers/test-server.js';
import { MockSheetService, createMockSheetRow } from '../helpers/mock-sheet-service.js';
import { clearStatsCache } from '../../routes/orders.js';

const ROW = 10;

describe('PATCH /api/orders/:rowNumber — 상품 · 수량 (#282)', () => {
  let server: FastifyInstance;
  let mock: MockSheetService;

  beforeAll(async () => {
    const setup = await createTestServer();
    server = setup.server;
    mock = setup.mockSheetService;
  });

  beforeEach(() => {
    mock.reset();
    clearStatsCache();
  });

  afterAll(async () => {
    await server.close();
  });

  const patch = (payload: Record<string, unknown>) =>
    server.inject({ method: 'PATCH', url: `/api/orders/${ROW}`, headers: AUTH_HEADERS, payload });

  function seed(overrides: Record<string, unknown> = {}) {
    mock.setMockAllOrders([createMockSheetRow({ _rowNumber: ROW, ...overrides })]);
  }

  /** 같은 시즌(2024-25)에 들어온 다른 주문 — 폼 문구(단가)를 여기서 가져온다 (#317) */
  const SAME_SEASON_10KG = createMockSheetRow({
    _rowNumber: 11,
    '타임스탬프': '2024. 12. 20. 오전 9:00:00',
    '상품 선택': '10kg (38,000 / box)',
    '5kg 수량': '',
    '10kg 수량': '1',
  });

  function seedWithSeason(overrides: Record<string, unknown>) {
    mock.setMockAllOrders([createMockSheetRow({ _rowNumber: ROW, ...overrides }), SAME_SEASON_10KG]);
  }

  it('오류 주문의 상품 · 수량을 고치면 둘 다 정하고 같은 시즌 폼 문구를 넘긴다 — 응답에서 검증 오류가 사라진다', async () => {
    seedWithSeason({ '상품 선택': '감귤 박스', '5kg 수량': '', '10kg 수량': '' });
    const res = await patch({ productType: '10kg', quantity: 2 });

    expect(res.statusCode).toBe(200);
    expect(mock.getUpdateOrderCalls()).toEqual([
      { rowNumber: ROW, updates: { productType: '10kg', quantity: 2, seasonSelection: '10kg (38,000 / box)' } },
    ]);
    const body = res.json();
    expect(body.order).toMatchObject({ productType: '10kg', quantity: 2 });
    expect(body.order.validationError ?? null).toBeNull();
  });

  it('수량만 고치면 지금 상품을 함께 넘긴다 (원문 단가 유지)', async () => {
    seed({ '상품 선택': '5kg (23,000 / box)', '5kg 수량': '', '10kg 수량': '' });
    const res = await patch({ quantity: 3 });
    expect(res.statusCode).toBe(200);
    expect(mock.getUpdateOrderCalls()[0].updates).toMatchObject({ productType: '5kg', quantity: 3 });
  });

  it('상품만 고치면 지금 수량을 함께 넘긴다', async () => {
    seedWithSeason({ '상품 선택': '5kg (23,000 / box)', '5kg 수량': '4', '10kg 수량': '' });
    const res = await patch({ productType: '10kg' });
    expect(res.statusCode).toBe(200);
    expect(mock.getUpdateOrderCalls()[0].updates).toEqual({ productType: '10kg', quantity: 4, seasonSelection: '10kg (38,000 / box)' });
  });

  it('#317 같은 시즌에 바꿀 상품 주문이 없으면 400 · 쓰지 않는다 (단가를 지어내지 않는다)', async () => {
    seed({ '상품 선택': '5kg (23,000 / box)', '5kg 수량': '1', '10kg 수량': '' });
    const res = await patch({ productType: '10kg' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('폼 단가를 찾지 못했습니다');
    expect(mock.getUpdateOrderCalls()).toEqual([]);
  });

  it('입금확인 주문도 고칠 수 있다', async () => {
    seed({ 비고: '입금확인' });
    expect((await patch({ quantity: 1 })).statusCode).toBe(200);
  });

  it('지금 상품이 오류인데 수량만 주면 400 · 쓰지 않는다', async () => {
    seed({ '상품 선택': '감귤 박스' });
    const res = await patch({ quantity: 2 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('상품');
    expect(mock.getUpdateOrderCalls()).toEqual([]);
  });

  it.each([
    [{ productType: '비상품' }],
    [{ productType: '3kg' }],
    [{ quantity: 0 }],
    [{ quantity: 1.5 }],
    [{ quantity: 1000 }],
  ])('잘못된 값 %j 은 400', async (payload) => {
    seed();
    expect((await patch(payload)).statusCode).toBe(400);
    expect(mock.getUpdateOrderCalls()).toEqual([]);
  });

  it('배송완료 주문은 409', async () => {
    seed({ 비고: '배송완료' });
    expect((await patch({ quantity: 2 })).statusCode).toBe(409);
    expect(mock.getUpdateOrderCalls()).toEqual([]);
  });

  it('배송사고(claim) 주문은 409', async () => {
    seed({ 주문유형: '배송사고' });
    const res = await patch({ quantity: 2 });
    expect(res.statusCode).toBe(409);
    expect(mock.getUpdateOrderCalls()).toEqual([]);
  });

  it('삭제된 주문은 400(기존 규칙)', async () => {
    seed({ 삭제됨: '2026-11-20' });
    expect((await patch({ quantity: 2 })).statusCode).toBe(400);
    expect(mock.getUpdateOrderCalls()).toEqual([]);
  });

  it('상품 · 수량이 없는 수정은 지금처럼 그대로 넘긴다', async () => {
    seed();
    const res = await patch({ recipient: { name: '새 이름' } });
    expect(res.statusCode).toBe(200);
    expect(mock.getUpdateOrderCalls()[0].updates).toEqual({ recipient: { name: '새 이름' } });
  });
});
