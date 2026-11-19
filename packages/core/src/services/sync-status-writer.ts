/**
 * 동기화 상태 칸(DB_SYNC_STATUS · DB_SYNC_AT · DB_SYNC_ID) 묶음 쓰기 — 쓰기 직전 행 확인 (#261)
 *
 * 동기화는 시트 스냅샷의 행 번호로 상태 칸을 쓴다. 전체 동기화는 행마다 1초씩 쉬어 수 분이 걸리고,
 * 그 사이 폼 응답이 위에 끼워지면(또는 행이 지워지면) 스냅샷 행 번호가 다른 주문을 가리킨다.
 * 그래서 상태 칸은 모아 두었다가 쓰기 직전에 그 행들의 `타임스탬프` 를 **한 번에** 읽어
 * 스냅샷과 같을 때만 batchUpdate 1회로 쓴다. 다르면 쓰지 않는다(쓰지 않는 쪽 · S-2).
 *
 * 확인 읽기와 batchUpdate 사이(수백 ms)의 틈은 Sheets API 로 없앨 수 없다 — 그래서 **쓴 직후 한 번 더 읽어**
 * 달라졌으면 'writtenThenShifted' 로 알린다(잘못 써진 `success` 가 증분 동기화에서 주문을 숨기는 조용한 유실 → 정지 · 알림).
 * 같은 초의 타임스탬프가 이웃한 행이면 1칸 밀림을 못 알아챈다(#264 색인과 같은 한계).
 *
 * 묶음 크기는 Sheets API 사용자당 분당 읽기 한도(60) 와 "프로세스가 죽으면 상태 칸이 빈 채로 남는 행 수" 사이의 절충이다.
 * 빈 상태 칸은 다음 증분 동기화가 다시 처리한다(이미 DB 에 있으므로 중복 · 알림 재발송 없음).
 */

import type { SheetService } from './sheet-service.js';
import { normalizeTimestampRaw } from './sheet-row-identity.js';

/** 한 번에 확인 · 쓰는 최대 행 수 */
export const SYNC_STATUS_BATCH_SIZE = 10;

/** 쓰기를 기다리는 상태 칸 한 행 */
export interface PendingSyncStatus {
  rowNumber: number;
  status: 'success' | 'fail';
  orderId?: number;
  /** 이번 실행 스냅샷에서 이 행의 `타임스탬프` 원문 */
  snapshotTimestamp: string;
  /** 이 행을 DB 에 반영한 시각 — DB_SYNC_AT 값(묶음을 쓴 시각이 아니다 · 웹 수정 충돌 감지 기준) */
  syncedAt: Date;
}

export type SyncStatusFlushOutcome =
  | { kind: 'written' }
  /** 썼고, 쓴 뒤 확인 읽기가 실패했다 — 쓰기 전 확인은 통과했으므로 쓴 것으로 본다 */
  | { kind: 'written'; postCheckError: string }
  /** 쓰기 전 확인에서 스냅샷과 다른 행(앞에서부터) — 아무것도 쓰지 않았다 */
  | { kind: 'shifted'; mismatchedRows: number[] }
  /** 썼는데 쓴 직후 다시 읽으니 달라졌다 — 상태 칸이 다른 행에 써졌을 수 있다(사람이 확인) */
  | { kind: 'writtenThenShifted'; mismatchedRows: number[] }
  /** verify = 쓰기 전 확인 읽기 실패(아무것도 쓰지 않음) · write = 쓰기 실패(일부가 써졌는지 알 수 없다) */
  | { kind: 'failed'; stage: 'verify' | 'write'; error: string };

/**
 * KST (UTC+9) ISO 8601 — "2024-02-01T21:34:56+09:00"
 */
export function formatKstTimestamp(date: Date): string {
  const kstTime = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${kstTime.getUTCFullYear()}-${pad(kstTime.getUTCMonth() + 1)}-${pad(kstTime.getUTCDate())}` +
    `T${pad(kstTime.getUTCHours())}:${pad(kstTime.getUTCMinutes())}:${pad(kstTime.getUTCSeconds())}+09:00`
  );
}

/** 상태 칸 값 — 성공은 주문 id, 실패는 id 를 비운다 */
export function buildSyncStatusCells(entry: PendingSyncStatus): Record<string, string> {
  const cells: Record<string, string> = { DB_SYNC_STATUS: entry.status, DB_SYNC_AT: formatKstTimestamp(entry.syncedAt) };
  if (entry.status === 'success' && entry.orderId !== undefined) {
    cells.DB_SYNC_ID = String(entry.orderId);
  } else if (entry.status === 'fail') {
    cells.DB_SYNC_ID = '';
  }
  return cells;
}

/**
 * 묶음의 행들이 아직 스냅샷과 같은 주문인지 한 번에 읽어 확인하고, 모두 같을 때만 한 번에 쓴다. 쓴 뒤 한 번 더 확인한다.
 * 시트 칸이 비었으면 다른 것으로 본다(엄격 — 쓰지 않는 쪽).
 */
export async function verifyAndWriteSyncStatuses(
  sheetService: Pick<SheetService, 'getTimestampsByRows' | 'updateRowsCells'>,
  entries: readonly PendingSyncStatus[]
): Promise<SyncStatusFlushOutcome> {
  if (entries.length === 0) return { kind: 'written' };
  const rowNumbers = entries.map((e) => e.rowNumber);

  let before: Map<number, string>;
  try {
    before = await sheetService.getTimestampsByRows(rowNumbers);
  } catch (error) {
    return { kind: 'failed', stage: 'verify', error: `sync status check failed: ${errorMessage(error)}` };
  }
  const mismatchedBefore = findMismatchedRows(entries, before);
  if (mismatchedBefore.length > 0) return { kind: 'shifted', mismatchedRows: mismatchedBefore };

  try {
    await sheetService.updateRowsCells(entries.map((e) => ({ row: e.rowNumber, updates: buildSyncStatusCells(e) })));
  } catch (error) {
    return { kind: 'failed', stage: 'write', error: errorMessage(error) };
  }

  let after: Map<number, string>;
  try {
    after = await sheetService.getTimestampsByRows(rowNumbers);
  } catch (error) {
    return { kind: 'written', postCheckError: errorMessage(error) };
  }
  const mismatchedAfter = findMismatchedRows(entries, after);
  if (mismatchedAfter.length > 0) return { kind: 'writtenThenShifted', mismatchedRows: mismatchedAfter };
  return { kind: 'written' };
}

/** 시트의 현재 타임스탬프가 스냅샷과 다르거나 빈 행 */
function findMismatchedRows(entries: readonly PendingSyncStatus[], current: ReadonlyMap<number, string>): number[] {
  return entries
    .filter((e) => {
      const sheetKey = normalizeTimestampRaw(current.get(e.rowNumber));
      return !sheetKey || sheetKey !== normalizeTimestampRaw(e.snapshotTimestamp);
    })
    .map((e) => e.rowNumber);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
