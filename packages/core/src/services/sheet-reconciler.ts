/**
 * hybrid 시트 반영 실패 자동 재조정 (#231 · DB 우선 #281)
 *
 * hybrid 쓰기에서 DB 는 성공했는데 시트 반영이 실패하면 주문에 `syncStatus='failed'` 가 남는다(#197).
 * hybrid 정본은 DB 이므로 판단할 일이 없다 — DB 현재 값을 시트 행에 다시 쓴다(멱등).
 *
 * - 쓰기 전: 시트 행의 `타임스탬프` 가 그 주문인지 확인(엄격 — 빈 칸 · 다른 주문이면 쓰지 않는다 · S-9)
 * - 쓴 뒤: 다시 읽어 확인 — 그 사이 행이 밀렸으면 표시를 남기고 보고(#261 과 같은 처리)
 * - 실패 표시는 **읽은 뒤 주문이 바뀌지 않았을 때(updatedAt 같음)만** 지운다. 웹 쓰기는 `sync` 락을 잡지 않으므로,
 *   그 사이 웹 수정이 있었다면 표시를 남겨 다음 회차가 최신 값으로 다시 맞추게 한다
 * - 쓰는 칸: 앱 칸(비고 · 송장번호 · 삭제됨 · 주문유형) · 웹에서 고칠 수 있는 칸 · DB_SYNC_*.
 *   고객 원본 칸(타임스탬프 · 주문자)은 쓰지 않는다
 * - 던지지 않는다 — 결과로 보고하고 호출자(sync-service)가 알린다
 */

import type { SheetService } from './sheet-service.js';
import type { DatabaseService } from './database-service.js';
import { matchesSheetRow } from './sheet-row-identity.js';
import { formatKstTimestamp } from './sync-status-writer.js';
import type { Logger } from './sync-engine.js';

/** 한 회차에 다시 맞추는 최대 주문 수 — 시트 호출은 회차당 읽기 2 · 쓰기 1 */
export const RECONCILE_BATCH_LIMIT = 10;

/** 재조정 대상 주문(DB) — 필요한 필드만 */
export interface ReconcileOrder {
  id: number;
  sheetRowNumber: number | null;
  timestamp: Date;
  timestampRaw: string | null;
  status: string;
  trackingNumber: string | null;
  deletedAt: Date | null;
  orderType: string;
  senderName: string;
  senderPhone: string;
  senderAddress: string;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  productSelection: string;
  quantity5kg: string;
  quantity10kg: string;
  updatedAt: Date;
}

export interface ReconcileResult {
  attempted: number;
  /** 시트를 DB 값으로 맞추고 표시를 지운 행 */
  reconciled: number[];
  /** 시트 행이 그 주문이 아니어서(행 밀림 · 빈 칸) 쓰지 않은 행 */
  skippedIdentity: number[];
  /** 썼는데 직후 행이 바뀐 행 — 상태 칸 등이 다른 행에 써졌을 수 있다(사람 확인) */
  shiftedAfterWrite: number[];
  /** 읽은 뒤 웹 수정으로 주문이 바뀌어 표시를 남긴 행 — 다음 회차가 최신 값으로 */
  stale: number[];
  /** 시트 읽기 · 쓰기 실패 */
  failed: Array<{ rowNumber: number; error: string }>;
}

const ORDER_TYPE_LABEL: Record<string, string> = { gift: '선물', claim: '배송사고', customer: '판매' };

/** DB 현재 값 → 시트 칸 (SheetService.updateOrder · softDelete · 상태 쓰기와 같은 표기) */
export function buildReconcileCells(order: ReconcileOrder): Record<string, string> {
  return {
    비고: order.status,
    송장번호: order.trackingNumber ?? '',
    삭제됨: order.deletedAt ? order.deletedAt.toISOString() : '',
    주문유형: ORDER_TYPE_LABEL[order.orderType] ?? '판매',
    '보내는분 성함': order.senderName,
    '보내는분 연락처 (핸드폰번호)': order.senderPhone,
    '보내는분 주소 (도로명 주소로 부탁드려요)': order.senderAddress,
    '받으실분 성함': order.recipientName,
    '받으실분 연락처 (핸드폰번호)': order.recipientPhone,
    '받으실분 주소 (도로명 주소로 부탁드려요)': order.recipientAddress,
    '상품 선택': order.productSelection,
    '5kg 수량': order.quantity5kg,
    '10kg 수량': order.quantity10kg,
    DB_SYNC_STATUS: 'success',
    DB_SYNC_AT: formatKstTimestamp(order.updatedAt),
    DB_SYNC_ID: String(order.id),
  };
}

/** 시트 행이 있는 재조정 대상 */
type Target = ReconcileOrder & { sheetRowNumber: number };

function emptyResult(attempted: number): ReconcileResult {
  return { attempted, reconciled: [], skippedIdentity: [], shiftedAfterWrite: [], stale: [], failed: [] };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class SheetReconciler {
  constructor(
    private readonly sheetService: Pick<SheetService, 'getTimestampsByRows' | 'updateRowsCells'>,
    private readonly databaseService: Pick<DatabaseService, 'getSheetSyncFailedOrders' | 'clearSheetSyncFailureIfUnchanged'>,
    private readonly logger?: Logger
  ) {}

  async reconcile(limit: number = RECONCILE_BATCH_LIMIT): Promise<ReconcileResult> {
    const orders: Target[] = (await this.databaseService.getSheetSyncFailedOrders(limit)).flatMap((o) =>
      o.sheetRowNumber === null ? [] : [{ ...o, sheetRowNumber: o.sheetRowNumber }]
    );
    if (orders.length === 0) return emptyResult(0);
    const result = emptyResult(orders.length);
    const rows = orders.map((o) => o.sheetRowNumber);

    // 1. 쓰기 전 행 확인
    let before: Map<number, string>;
    try {
      before = await this.sheetService.getTimestampsByRows(rows);
    } catch (error) {
      return this.failAll(result, rows, `row check read failed: ${errorMessage(error)}`);
    }
    const targets = orders.filter((o) => matchesSheetRow(o, before.get(o.sheetRowNumber)));
    result.skippedIdentity = orders.filter((o) => !targets.includes(o)).map((o) => o.sheetRowNumber);
    if (targets.length === 0) return this.report(result);

    // 2. DB 현재 값을 한 번에 쓴다
    const targetRows = targets.map((o) => o.sheetRowNumber);
    try {
      await this.sheetService.updateRowsCells(targets.map((o) => ({ row: o.sheetRowNumber, updates: buildReconcileCells(o) })));
    } catch (error) {
      return this.failAll(result, targetRows, `sheet write failed: ${errorMessage(error)}`);
    }

    // 3. 쓴 뒤 확인 — 읽지 못하면 지우지 않는다(다음 회차가 다시 확인하고 쓴다 · 같은 값이라 멱등)
    let after: Map<number, string>;
    try {
      after = await this.sheetService.getTimestampsByRows(targetRows);
    } catch (error) {
      return this.failAll(result, targetRows, `post-write row check failed: ${errorMessage(error)}`);
    }

    // 4. 주문이 그대로일 때만 표시를 지운다
    for (const o of targets) {
      if (!matchesSheetRow(o, after.get(o.sheetRowNumber))) {
        result.shiftedAfterWrite.push(o.sheetRowNumber);
        continue;
      }
      const cleared = await this.databaseService.clearSheetSyncFailureIfUnchanged(o.id, o.updatedAt);
      (cleared > 0 ? result.reconciled : result.stale).push(o.sheetRowNumber);
    }
    return this.report(result);
  }

  private failAll(result: ReconcileResult, rows: number[], error: string): ReconcileResult {
    result.failed = rows.map((rowNumber) => ({ rowNumber, error }));
    return this.report(result);
  }

  private report(result: ReconcileResult): ReconcileResult {
    const problem =
      result.failed.length > 0 || result.skippedIdentity.length > 0 || result.shiftedAfterWrite.length > 0;
    const summary = {
      attempted: result.attempted,
      reconciled: result.reconciled,
      skippedIdentity: result.skippedIdentity,
      shiftedAfterWrite: result.shiftedAfterWrite,
      stale: result.stale,
      failed: result.failed,
    };
    if (problem) this.logger?.warn(summary, 'Sheet reconcile: some rows not reconciled (#231)');
    else this.logger?.info(summary, 'Sheet reconcile completed (#231)');
    return result;
  }
}
