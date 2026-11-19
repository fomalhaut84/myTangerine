/**
 * 신규 주문 알림 표시 (#251)
 *
 * cron 동기화가 주문을 **처음 만들 때**만, 주문 시각이 최근(기본 24시간)이고 '삭제됨'이 아니면
 * newOrderNotice='pending' 을 같은 upsert 의 create 쪽에 기록한다.
 * 수동 동기화(api)는 정책을 넘기지 않으므로 표시하지 않는다.
 *
 * Prisma · SheetService 는 mock 이다(S-4).
 */

import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { DatabaseService } from '../database-service.js';
import { SyncEngine } from '../sync-engine.js';
import {
  shouldFlagNewOrderNotice,
  NEW_ORDER_NOTICE_WINDOW_MS,
  type NewOrderNoticePolicy,
} from '../new-order-notice.js';
import type { Config } from '../../config/config.js';
import type { SheetService } from '../sheet-service.js';
import { parseKoreanTimestamp, type SheetRow } from '../../types/order.js';

// 시트 타임스탬프는 실행 환경의 로컬 시간으로 읽힌다 — NOW 도 같은 파서로 만들어 시간대와 무관하게 한다
const NOW = parseKoreanTimestamp('2026. 11. 19. 오후 12:00:00');
const POLICY: NewOrderNoticePolicy = { windowMs: NEW_ORDER_NOTICE_WINDOW_MS, now: () => NOW };

/** 30분 전 */
const RECENT_TS = '2026. 11. 19. 오전 11:30:00';
/** 2일 전 */
const OLD_TS = '2026. 11. 17. 오전 11:30:00';

function sheetRow(overrides: Record<string, unknown> = {}): SheetRow {
  return {
    _rowNumber: 10,
    타임스탬프: RECENT_TS,
    비고: '',
    보내는분: '보내는이',
    '보내는분 주소 (도로명 주소로 부탁드려요)': '제주시',
    '보내는분 연락처 (핸드폰번호)': '010-1111-2222',
    받으실분: '받는이',
    '받으실분 주소 (도로명 주소로 부탁드려요)': '서울시',
    '받으실분 연락처 (핸드폰번호)': '010-3333-4444',
    '상품 선택': '5kg',
    '5kg 수량': '1',
    '10kg 수량': '',
    ...overrides,
  } as unknown as SheetRow;
}

describe('shouldFlagNewOrderNotice', () => {
  it('최근 주문 · 삭제 아님 → true', () => {
    expect(shouldFlagNewOrderNotice({ timestamp: new Date(NOW.getTime() - 60_000), deletedAt: undefined }, POLICY)).toBe(true);
    expect(shouldFlagNewOrderNotice({ timestamp: new Date(NOW.getTime() - 60_000), deletedAt: null }, POLICY)).toBe(true);
  });

  it('창 밖(24시간 초과) → false', () => {
    expect(
      shouldFlagNewOrderNotice({ timestamp: new Date(NOW.getTime() - NEW_ORDER_NOTICE_WINDOW_MS - 1), deletedAt: null }, POLICY)
    ).toBe(false);
  });

  it('창 경계(정확히 24시간)는 포함', () => {
    expect(
      shouldFlagNewOrderNotice({ timestamp: new Date(NOW.getTime() - NEW_ORDER_NOTICE_WINDOW_MS), deletedAt: null }, POLICY)
    ).toBe(true);
  });

  it('시간대 차이로 미래처럼 보이는 시각도 창 안이면 true · 창 밖이면 false', () => {
    expect(shouldFlagNewOrderNotice({ timestamp: new Date(NOW.getTime() + 9 * 3600_000), deletedAt: null }, POLICY)).toBe(true);
    expect(
      shouldFlagNewOrderNotice({ timestamp: new Date(NOW.getTime() + NEW_ORDER_NOTICE_WINDOW_MS + 1), deletedAt: null }, POLICY)
    ).toBe(false);
  });

  it('삭제됨 표시 행 → false', () => {
    expect(shouldFlagNewOrderNotice({ timestamp: NOW, deletedAt: new Date() }, POLICY)).toBe(false);
  });

  it('시각을 읽을 수 없으면(Invalid Date) → false', () => {
    expect(shouldFlagNewOrderNotice({ timestamp: new Date('x'), deletedAt: null }, POLICY)).toBe(false);
  });

  it('정책이 없으면(수동 동기화) → false', () => {
    expect(shouldFlagNewOrderNotice({ timestamp: NOW, deletedAt: null }, undefined)).toBe(false);
  });
});

function dbWith(upsertResult: Record<string, unknown> = { id: 1, newOrderNotice: null }) {
  const prisma = {
    order: {
      upsert: vi.fn().mockResolvedValue(upsertResult),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const service = new DatabaseService({} as Config, prisma as unknown as PrismaClient);
  return { prisma, service };
}

describe('DatabaseService.upsertOrder — 알림 표시는 create 쪽에만', () => {
  it('정책이 있고 최근 주문이면 create 에 pending · update 에는 넣지 않는다', async () => {
    const { prisma, service } = dbWith();
    await service.upsertOrder(sheetRow(), { syncStatus: 'success', syncAttemptCount: 1 }, { newOrderNotice: POLICY });
    const arg = prisma.order.upsert.mock.calls[0][0];
    expect(arg.create.newOrderNotice).toBe('pending');
    expect(arg.update).not.toHaveProperty('newOrderNotice');
  });

  it('정책이 없으면 create 에도 넣지 않는다', async () => {
    const { prisma, service } = dbWith();
    await service.upsertOrder(sheetRow(), { syncStatus: 'success', syncAttemptCount: 1 });
    expect(prisma.order.upsert.mock.calls[0][0].create).not.toHaveProperty('newOrderNotice');
  });

  it('오래된 주문은 정책이 있어도 넣지 않는다', async () => {
    const { prisma, service } = dbWith();
    await service.upsertOrder(sheetRow({ 타임스탬프: OLD_TS }), { syncStatus: 'success' }, { newOrderNotice: POLICY });
    expect(prisma.order.upsert.mock.calls[0][0].create).not.toHaveProperty('newOrderNotice');
  });

  it('삭제됨 표시 행은 넣지 않는다', async () => {
    const { prisma, service } = dbWith();
    await service.upsertOrder(sheetRow({ 삭제됨: '2026-11-19' }), { syncStatus: 'success' }, { newOrderNotice: POLICY });
    expect(prisma.order.upsert.mock.calls[0][0].create).not.toHaveProperty('newOrderNotice');
  });
});

describe('DatabaseService 알림 대기 조회 · 결과 기록', () => {
  it('대기 목록은 pending · 삭제 안 됨 · 시트 행 있음 · id 순 · 상한', async () => {
    const { prisma, service } = dbWith();
    prisma.order.findMany.mockResolvedValue([{ id: 3, sheetRowNumber: 12 }]);
    const rows = await service.getPendingNewOrderNotices(20);
    expect(rows).toEqual([{ id: 3, sheetRowNumber: 12 }]);
    expect(prisma.order.findMany).toHaveBeenCalledWith({
      where: { newOrderNotice: 'pending', deletedAt: null, sheetRowNumber: { not: null } },
      select: { id: true, sheetRowNumber: true },
      orderBy: { id: 'asc' },
      take: 20,
    });
  });

  it('결과 기록은 pending 일 때만 바꾼다(중복 기록 방지)', async () => {
    const { prisma, service } = dbWith();
    const changed = await service.setNewOrderNoticeResult(3, 'sent', NOW);
    expect(changed).toBe(true);
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: 3, newOrderNotice: 'pending' },
      data: { newOrderNotice: 'sent', newOrderNoticeAt: NOW },
    });
  });

  it('이미 바뀐 행이면 false', async () => {
    const { prisma, service } = dbWith();
    prisma.order.updateMany.mockResolvedValue({ count: 0 });
    expect(await service.setNewOrderNoticeResult(3, 'rejected', NOW)).toBe(false);
  });
});

describe('SyncEngine — 정책은 새로 만드는 행에만 넘긴다', () => {
  function engine(existing: Record<string, unknown> | null, options?: { newOrderNotice?: NewOrderNoticePolicy }) {
    const sheetService = {
      getAllRows: vi.fn().mockResolvedValue([sheetRow()]),
      updateCell: vi.fn(),
      updateRowCells: vi.fn().mockResolvedValue(undefined),
      updateSyncStatus: vi.fn().mockResolvedValue(undefined),
    };
    const databaseService = {
      getRawOrderByRowNumber: vi.fn().mockResolvedValue(existing),
      upsertOrder: vi.fn().mockResolvedValue({ id: 5, newOrderNotice: existing ? null : 'pending' }),
    };
    const e = new SyncEngine(
      sheetService as unknown as SheetService,
      databaseService as unknown as DatabaseService,
      undefined,
      undefined,
      options
    );
    // 행 사이 1초 대기와 시트 상태 쓰기는 이 테스트의 관심 밖
    vi.spyOn(e as unknown as { updateSheetSyncStatus: () => Promise<void> }, 'updateSheetSyncStatus').mockResolvedValue();
    return { e, databaseService };
  }

  it('DB 에 없는 행 + 정책 → upsertOrder 에 정책 전달 · 결과에 표시 건수', async () => {
    vi.useFakeTimers();
    try {
      const { e, databaseService } = engine(null, { newOrderNotice: POLICY });
      const p = e.incrementalSync();
      await vi.runAllTimersAsync();
      const result = await p;
      expect(databaseService.upsertOrder.mock.calls[0][2]).toEqual({ newOrderNotice: POLICY });
      expect(result.newOrderNotices).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('DB 에 이미 있는 행 → 정책을 넘기지 않는다', async () => {
    vi.useFakeTimers();
    try {
      const { e, databaseService } = engine({ id: 5, syncAttemptCount: 1, lastModifiedBy: 'sync' }, { newOrderNotice: POLICY });
      const p = e.incrementalSync();
      await vi.runAllTimersAsync();
      const result = await p;
      expect(databaseService.upsertOrder.mock.calls[0][2]).toBeUndefined();
      expect(result.newOrderNotices).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('정책 옵션이 없으면(api 수동 동기화) 새 행이어도 넘기지 않는다', async () => {
    vi.useFakeTimers();
    try {
      const { e, databaseService } = engine(null);
      const p = e.incrementalSync();
      await vi.runAllTimersAsync();
      await p;
      expect(databaseService.upsertOrder.mock.calls[0][2]).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
