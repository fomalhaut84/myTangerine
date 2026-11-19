/**
 * 동기화 상태 칸(DB_SYNC_*) 쓰기 전 행 확인 (#261)
 *
 * 전체 동기화는 행마다 1초씩 쉬어 수 분이 걸린다. 그 사이 폼 응답이 위에 끼워지면 스냅샷의 행 번호로 쓴
 * 상태 칸이 다른 주문 행에 기록된다. 그래서 상태 칸은 모아 두었다가(최대 SYNC_STATUS_BATCH_SIZE 행)
 * 쓰기 직전에 그 행들의 `타임스탬프` 를 한 번에 읽어 스냅샷과 같을 때만 한 번에 쓴다.
 * - 하나라도 다르면 그 묶음은 쓰지 않고 이번 실행을 멈춘다(밀림 신호 · #260 알림)
 * - 확인 읽기 · 쓰기가 실패하면 그 묶음 행은 실패로 센다(지금의 시트 쓰기 실패와 같다)
 *
 * SheetService · DatabaseService 는 mock 이다(S-4).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { SyncEngine } from '../sync-engine.js';
import { SYNC_STATUS_BATCH_SIZE } from '../sync-status-writer.js';
import type { SheetRow } from '../../types/order.js';
import type { SheetService } from '../sheet-service.js';
import type { DatabaseService } from '../database-service.js';

afterEach(() => {
  vi.useRealTimers();
});

function ts(rowNumber: number): string {
  // 행마다 다른 타임스탬프(분 · 초)
  const minute = Math.floor(rowNumber / 60) % 60;
  const second = rowNumber % 60;
  return `2026. 11. 19. 오전 10:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
}

function sheetRow(rowNumber: number): SheetRow {
  return {
    _rowNumber: rowNumber,
    타임스탬프: ts(rowNumber),
    비고: '',
    '상품 선택': '5kg',
    '5kg 수량': '1',
    '10kg 수량': '',
  } as unknown as SheetRow;
}

type Written = Array<{ row: number; updates: Record<string, string> }>;

function engine(opts: {
  rowNumbers: number[];
  /** 확인 읽기 때 시트의 현재 타임스탬프 — 없으면 스냅샷과 같다 */
  current?: (row: number) => string;
  readError?: Error;
  writeError?: Error;
  upsertError?: (row: number) => Error | null;
}) {
  const rows = opts.rowNumbers.map(sheetRow);
  const physical = rows.map((r) => ({ _rowNumber: r._rowNumber as number, 타임스탬프: r['타임스탬프'] as string }));
  const writes: Written[] = [];
  const sheetService = {
    getAllRowsSnapshot: vi.fn().mockResolvedValue({ rows, physical }),
    getTimestampsByRows: vi.fn().mockImplementation(async (nums: number[]) => {
      if (opts.readError) throw opts.readError;
      return new Map(nums.map((n) => [n, opts.current ? opts.current(n) : ts(n)]));
    }),
    updateRowsCells: vi.fn().mockImplementation(async (batch: Written) => {
      if (opts.writeError) throw opts.writeError;
      writes.push(batch);
    }),
    updateRowCells: vi.fn(),
  };
  const databaseService = {
    getRawOrderByRowNumber: vi.fn().mockResolvedValue(null),
    findOrderAtOtherRow: vi.fn().mockResolvedValue(null),
    upsertOrder: vi.fn().mockImplementation(async (row: SheetRow) => {
      const err = opts.upsertError?.(row._rowNumber as number);
      if (err) throw err;
      return { id: 1000 + (row._rowNumber as number), newOrderNotice: null };
    }),
  };
  const e = new SyncEngine(
    sheetService as unknown as SheetService,
    databaseService as unknown as DatabaseService
  );
  return { e, sheetService, databaseService, writes };
}

async function run(e: SyncEngine, mode: 'incremental' | 'full' = 'full') {
  vi.useFakeTimers();
  const p = mode === 'full' ? e.fullResync() : e.incrementalSync();
  await vi.runAllTimersAsync();
  return p;
}

const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);

describe('SyncEngine — 상태 칸 쓰기 전 행 확인 (#261)', () => {
  it('타임스탬프가 스냅샷과 같으면 확인 1회 · 쓰기 1회로 묶음 전체를 쓴다', async () => {
    const { e, sheetService, writes } = engine({ rowNumbers: [10, 11, 12] });
    const result = await run(e);

    expect(sheetService.getTimestampsByRows).toHaveBeenCalledTimes(1);
    expect(sheetService.getTimestampsByRows).toHaveBeenCalledWith([10, 11, 12]);
    expect(sheetService.updateRowsCells).toHaveBeenCalledTimes(1);
    expect(sheetService.updateRowCells).not.toHaveBeenCalled();
    expect(writes[0].map((w) => [w.row, w.updates.DB_SYNC_STATUS, w.updates.DB_SYNC_ID])).toEqual([
      [10, 'success', '1010'],
      [11, 'success', '1011'],
      [12, 'success', '1012'],
    ]);
    expect(writes[0][0].updates.DB_SYNC_AT).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
    expect(result).toMatchObject({ total: 3, success: 3, failed: 0, rowShiftDetected: false });
    expect(result.identityConflictRows).toEqual([]);
  });

  it(`묶음은 ${SYNC_STATUS_BATCH_SIZE}행씩 — 넘으면 나눠 확인 · 쓰기`, async () => {
    const { e, sheetService } = engine({ rowNumbers: range(2, SYNC_STATUS_BATCH_SIZE + 3) });
    const result = await run(e);

    expect(sheetService.getTimestampsByRows).toHaveBeenCalledTimes(2);
    expect(sheetService.getTimestampsByRows.mock.calls[0][0]).toHaveLength(SYNC_STATUS_BATCH_SIZE);
    expect(sheetService.getTimestampsByRows.mock.calls[1][0]).toEqual(range(2 + SYNC_STATUS_BATCH_SIZE, 3));
    expect(sheetService.updateRowsCells).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(SYNC_STATUS_BATCH_SIZE + 3);
  });

  it('묶음 중 한 행이라도 타임스탬프가 다르면(폼이 끼워 넣어 밀림) 그 묶음은 쓰지 않고 남은 행도 처리하지 않는다', async () => {
    const total = SYNC_STATUS_BATCH_SIZE + 5;
    const rowNumbers = range(2, total);
    // 두 번째 묶음 확인 때 13행 위에 응답이 끼워져 13행부터 한 칸씩 밀렸다
    const shiftAt = 2 + SYNC_STATUS_BATCH_SIZE + 1;
    const { e, sheetService, databaseService, writes } = engine({
      rowNumbers,
      current: (n) => (n >= shiftAt ? ts(n - 1) : ts(n)),
    });
    // 첫 묶음(2..11) 확인 때는 아직 밀리지 않았다
    let checks = 0;
    sheetService.getTimestampsByRows.mockImplementation(async (nums: number[]) => {
      checks++;
      return new Map(nums.map((n) => [n, checks === 1 || n < shiftAt ? ts(n) : ts(n - 1)]));
    });

    const result = await run(e);

    expect(writes).toHaveLength(1); // 첫 묶음만 썼다
    expect(writes[0].map((w) => w.row)).toEqual(range(2, SYNC_STATUS_BATCH_SIZE));
    expect(result.rowShiftDetected).toBe(true);
    // 쓰지 않은 두 번째 묶음 행 전체가 정지 행(#260 알림)
    const secondBatch = range(2 + SYNC_STATUS_BATCH_SIZE, SYNC_STATUS_BATCH_SIZE).filter((n) => n < 2 + total);
    expect(result.identityConflictRows).toEqual(secondBatch);
    expect(result.failed).toBe(secondBatch.length);
    expect(result.errors.every((x) => x.error.includes('#261'))).toBe(true);
    expect(result.errors[0].error).toContain(`row ${shiftAt}`);
    // 두 번째 묶음까지만 DB 에 반영됐다 — 그 뒤는 처리하지 않았다
    expect(databaseService.upsertOrder).toHaveBeenCalledTimes(Math.min(total, SYNC_STATUS_BATCH_SIZE * 2));
  });

  it('밀림을 찾으면 그 뒤 행은 DB 에도 반영하지 않는다', async () => {
    const rowNumbers = range(2, SYNC_STATUS_BATCH_SIZE * 2 + 3);
    const { e, databaseService, writes } = engine({ rowNumbers, current: (n) => ts(n - 1) });
    const result = await run(e);

    expect(writes).toHaveLength(0);
    expect(databaseService.upsertOrder).toHaveBeenCalledTimes(SYNC_STATUS_BATCH_SIZE);
    expect(result).toMatchObject({ success: 0, failed: SYNC_STATUS_BATCH_SIZE, rowShiftDetected: true });
  });

  it('시트 칸이 비어 있어도(행이 지워져 당겨짐) 다른 것으로 보고 쓰지 않는다', async () => {
    const { e, writes } = engine({ rowNumbers: [10, 11], current: (n) => (n === 11 ? '' : ts(n)) });
    const result = await run(e);
    expect(writes).toHaveLength(0);
    expect(result.identityConflictRows).toEqual([10, 11]);
  });

  it('표시 형식만 다르면(점 · 공백 · 앞자리 0) 같은 행으로 본다', async () => {
    const { e, writes } = engine({ rowNumbers: [10], current: (n) => ts(n).replace('11. 19.', '11. 19') });
    const result = await run(e);
    expect(writes).toHaveLength(1);
    expect(result.success).toBe(1);
  });

  it('DB 반영 실패 행의 fail 기록도 같은 확인을 거친다', async () => {
    const { e, writes } = engine({
      rowNumbers: [10, 11],
      upsertError: (n) => (n === 11 ? new Error('db down') : null),
    });
    const result = await run(e);
    expect(writes[0].map((w) => [w.row, w.updates.DB_SYNC_STATUS, w.updates.DB_SYNC_ID])).toEqual([
      [10, 'success', '1010'],
      [11, 'fail', ''],
    ]);
    expect(result).toMatchObject({ success: 1, failed: 1 });
    expect(result.errors[0]).toMatchObject({ rowNumber: 11 });
    expect(result.errors[0].error).toContain('DB upsert failed: db down');
  });

  it('밀려서 fail 도 쓰지 못한 행은 원래 DB 실패 사유를 남기고 정지 행에 든다', async () => {
    const { e, writes } = engine({
      rowNumbers: [10],
      upsertError: () => new Error('db down'),
      current: (n) => ts(n - 1),
    });
    const result = await run(e);
    expect(writes).toHaveLength(0);
    expect(result.identityConflictRows).toEqual([10]);
    expect(result.errors[0].error).toContain('db down');
    expect(result.errors[0].error).toContain('#261');
  });

  it('확인 읽기가 실패하면 쓰지 않고 그 묶음 성공 행을 실패로 센다 · 동기화는 계속한다', async () => {
    const { e, sheetService, writes } = engine({
      rowNumbers: range(2, SYNC_STATUS_BATCH_SIZE + 1),
      readError: new Error('quota'),
    });
    const result = await run(e);
    expect(writes).toHaveLength(0);
    expect(sheetService.getTimestampsByRows).toHaveBeenCalledTimes(2); // 다음 묶음도 시도
    expect(result).toMatchObject({ success: 0, failed: SYNC_STATUS_BATCH_SIZE + 1, rowShiftDetected: false });
    expect(result.errors[0].error).toContain('Sheets update failed');
    expect(result.errors[0].error).toContain('quota');
    expect(result.identityConflictRows).toEqual([]);
  });

  it('쓰기가 실패하면 그 묶음 성공 행을 실패로 센다(지금의 시트 쓰기 실패와 같다)', async () => {
    const { e } = engine({ rowNumbers: [10, 11], writeError: new Error('503') });
    const result = await run(e);
    expect(result).toMatchObject({ success: 0, failed: 2 });
    expect(result.errors.map((x) => x.rowNumber)).toEqual([10, 11]);
    expect(result.errors[0].error).toContain('Sheets update failed: 503');
  });

  it('증분 동기화에서 이미 success 인 행만 있으면 확인 읽기도 하지 않는다', async () => {
    const { e, sheetService } = engine({ rowNumbers: [10, 11] });
    const snapshot = await sheetService.getAllRowsSnapshot();
    sheetService.getAllRowsSnapshot.mockResolvedValue({
      ...snapshot,
      rows: snapshot.rows.map((r: SheetRow) => ({ ...r, DB_SYNC_STATUS: 'success' })),
    });
    const result = await run(e, 'incremental');
    expect(sheetService.getTimestampsByRows).not.toHaveBeenCalled();
    expect(sheetService.updateRowsCells).not.toHaveBeenCalled();
    expect(result.skipped).toBe(2);
  });
});
