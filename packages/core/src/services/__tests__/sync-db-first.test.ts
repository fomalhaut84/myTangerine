/**
 * hybrid DB 우선 동기화 (#281)
 *
 * 정본은 DB 다. 시트 → DB 는 새 주문이 처음 들어올 때만 쓴다.
 * - 증분(cron · 수동): DB 에 있는 같은 주문은 시트 값이 달라도 DB 를 바꾸지 않는다 — 상태 칸만 쓴다
 * - 전체(시트 우선 가져오기 · 운영자 복구): 지금처럼 시트 값으로 덮어쓰되 바뀐 필드를 변경 이력에 남기고,
 *   DB 에만 있는 변경(시트 반영 실패 · syncStatus=failed)은 덮어쓰지 않는다
 * - 새 주문을 만들 때 최초 입력값(original_input)을 저장한다
 *
 * SheetService · Prisma 는 mock 이다(S-4).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { SyncEngine } from '../sync-engine.js';
import { DatabaseService } from '../database-service.js';
import type { ChangeLogService } from '../change-log-service.js';
import { parseKoreanTimestamp, type SheetRow } from '../../types/order.js';
import type { SheetService } from '../sheet-service.js';
import type { Config } from '../../config/config.js';

const TS = '2026. 11. 19. 오전 10:26:32';

function sheetRow(overrides: Record<string, string> = {}): SheetRow {
  return {
    _rowNumber: 10,
    타임스탬프: TS,
    비고: '',
    '보내는분 성함': '시트 보내는이',
    '받으실분 성함': '시트 받는이',
    '받으실분 주소 (도로명 주소로 부탁드려요)': '시트 주소',
    '받으실분 연락처 (핸드폰번호)': '010-0000-0000',
    '상품 선택': '5kg',
    '5kg 수량': '1',
    '10kg 수량': '',
    ...overrides,
  } as unknown as SheetRow;
}

const EXISTING = {
  id: 5,
  sheetRowNumber: 10,
  timestamp: parseKoreanTimestamp(TS),
  timestampRaw: TS,
  recipientName: '웹에서 고친 받는이',
  version: 3,
  deletedAt: null,
  syncStatus: 'success',
  syncAttemptCount: 1,
  lastModifiedBy: 'web',
  lastModifiedAt: new Date('2026-11-19T00:00:00Z'),
};

afterEach(() => {
  vi.useRealTimers();
});

function engine(existing: Record<string, unknown> | null, row: SheetRow = sheetRow()) {
  const writes: Array<{ row: number; updates: Record<string, string> }> = [];
  const sheetService = {
    getAllRowsSnapshot: vi.fn().mockResolvedValue({
      rows: [row],
      physical: [{ _rowNumber: row._rowNumber as number, 타임스탬프: row['타임스탬프'] as string }],
    }),
    getTimestampsByRows: vi.fn().mockImplementation(async (nums: number[]) => new Map(nums.map((n) => [n, TS]))),
    updateRowsCells: vi.fn().mockImplementation(async (batch: typeof writes) => {
      writes.push(...batch);
    }),
  };
  const databaseService = {
    getRawOrderByRowNumber: vi.fn().mockResolvedValue(existing),
    findOrderAtOtherRow: vi.fn().mockResolvedValue(null),
    upsertOrder: vi.fn().mockImplementation(async () => ({ id: existing?.id ?? 99, newOrderNotice: null })),
  };
  const changeLogService = {
    hasUnresolvedConflict: vi.fn().mockResolvedValue(false),
    logChange: vi.fn().mockResolvedValue(undefined),
  };
  const e = new SyncEngine(
    sheetService as unknown as SheetService,
    databaseService as unknown as DatabaseService,
    undefined,
    changeLogService as unknown as ChangeLogService
  );
  return { e, databaseService, changeLogService, writes };
}

async function run(e: SyncEngine, mode: 'incremental' | 'full') {
  vi.useFakeTimers();
  const p = mode === 'full' ? e.fullResync() : e.incrementalSync();
  await vi.runAllTimersAsync();
  return p;
}

describe('SyncEngine — 증분 동기화는 새 주문만 만든다 (#281)', () => {
  it('DB 에 있는 같은 주문은 시트 값이 달라도 DB 를 바꾸지 않고 상태 칸만 쓴다', async () => {
    const { e, databaseService, changeLogService, writes } = engine(EXISTING);
    const result = await run(e, 'incremental');

    expect(databaseService.upsertOrder).not.toHaveBeenCalled();
    expect(changeLogService.logChange).not.toHaveBeenCalled();
    expect(writes.map((w) => [w.row, w.updates.DB_SYNC_STATUS, w.updates.DB_SYNC_ID])).toEqual([[10, 'success', '5']]);
    expect(result).toMatchObject({ success: 1, failed: 0, conflicts: 0 });
  });

  it('웹 수정이 시트 동기화 시각보다 새로워도 더는 충돌로 보지 않는다(DB 가 정본)', async () => {
    const { e, changeLogService } = engine(EXISTING, sheetRow({ DB_SYNC_AT: '2026-11-18T00:00:00+09:00' }));
    const result = await run(e, 'incremental');
    expect(result.conflicts).toBe(0);
    expect(changeLogService.hasUnresolvedConflict).not.toHaveBeenCalled();
  });

  it('시트 반영 실패 표시(syncStatus=failed)를 지우지 않는다 — DB 를 쓰지 않으므로 (#231 선행)', async () => {
    const { e, databaseService } = engine({ ...EXISTING, syncStatus: 'failed' });
    await run(e, 'incremental');
    expect(databaseService.upsertOrder).not.toHaveBeenCalled();
  });

  it('DB 에 없는 행은 지금처럼 만든다', async () => {
    const { e, databaseService } = engine(null);
    const result = await run(e, 'incremental');
    expect(databaseService.upsertOrder).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(1);
  });
});

describe('SyncEngine — 전체 동기화 = 시트 우선 가져오기(운영자 복구) (#281)', () => {
  it('기존 주문을 시트 값으로 덮어쓰고 바뀐 필드를 변경 이력(sync · update)에 남긴다', async () => {
    const { e, databaseService, changeLogService } = engine({ ...EXISTING, lastModifiedBy: 'sync' });
    const result = await run(e, 'full');

    expect(databaseService.upsertOrder).toHaveBeenCalledTimes(1);
    expect(changeLogService.logChange).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 5,
        sheetRowNumber: 10,
        changedBy: 'sync',
        action: 'update',
        previousVersion: 3,
        fieldChanges: expect.objectContaining({ recipientName: { old: '웹에서 고친 받는이', new: '시트 받는이' } }),
      })
    );
    expect(result.success).toBe(1);
  });

  it('바뀐 필드가 없으면 이력을 남기지 않는다', async () => {
    const same = {
      ...EXISTING,
      lastModifiedBy: 'sync',
      senderName: '시트 보내는이',
      recipientName: '시트 받는이',
      recipientAddress: '시트 주소',
      recipientPhone: '010-0000-0000',
      quantity5kg: '1',
      quantity10kg: '',
    };
    const { e, changeLogService } = engine(same);
    await run(e, 'full');
    expect(changeLogService.logChange).not.toHaveBeenCalled();
  });

  it('DB 에만 있는 변경(syncStatus=failed)은 덮어쓰지 않고 충돌로 알린다', async () => {
    const { e, databaseService } = engine({ ...EXISTING, syncStatus: 'failed' });
    const result = await run(e, 'full');
    expect(databaseService.upsertOrder).not.toHaveBeenCalled();
    expect(result.conflicts).toBe(1);
    expect(result.conflictDetails[0].reason).toContain('#281');
  });

  it('웹 수정이 시트 동기화 시각보다 새로우면 지금처럼 충돌(덮어쓰지 않음)', async () => {
    const { e, databaseService } = engine(EXISTING, sheetRow({ DB_SYNC_AT: '2026-11-18T00:00:00+09:00' }));
    const result = await run(e, 'full');
    expect(databaseService.upsertOrder).not.toHaveBeenCalled();
    expect(result.conflicts).toBe(1);
  });
});

describe('DatabaseService — 새 주문에 최초 입력값 저장 (#281)', () => {
  function dbWith() {
    const prisma = {
      order: { upsert: vi.fn().mockResolvedValue({ id: 1 }) },
    };
    const service = new DatabaseService({} as Config, prisma as unknown as PrismaClient);
    return { prisma, service };
  }

  it('create 에만 original_input 을 넣고 update(시트 우선 가져오기)에는 넣지 않는다', async () => {
    const { prisma, service } = dbWith();
    await service.upsertOrder(sheetRow({ '추가 요청사항': '문 앞', 비고: '입금확인', DB_SYNC_STATUS: 'fail' }));
    const arg = prisma.order.upsert.mock.calls[0][0];
    expect(arg.create.originalInput).toMatchObject({ 타임스탬프: TS, '받으실분 성함': '시트 받는이', '추가 요청사항': '문 앞' });
    expect(arg.create.originalInput).not.toHaveProperty('비고');
    expect(arg.create.originalInput).not.toHaveProperty('DB_SYNC_STATUS');
    expect(arg.update).not.toHaveProperty('originalInput');
  });
});
