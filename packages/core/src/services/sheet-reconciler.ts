/**
 * hybrid 시트 반영 실패 자동 재조정 (#231 · DB 우선 #281)
 *
 * hybrid 쓰기에서 DB 는 성공했는데 시트 반영이 실패하면 주문에 `syncStatus='failed'` 가 남는다(#197).
 * hybrid 정본은 DB 이므로 판단할 일이 없다 — DB 현재 값을 시트 행에 다시 맞춘다(멱등).
 *
 * 1. 헤더(1행)와 대상 행을 **한 요청으로 새로 읽는다** — 헤더 캐시가 낡아(폼 질문 추가로 열이 밀림) 엉뚱한 열에 쓰지 않게
 * 2. 행의 `타임스탬프` 가 그 주문인지 확인(엄격 — 빈 칸 · 다른 주문이면 쓰지 않는다 · S-9)
 * 3. DB 값과 **다른 칸만** 쓴다 — 확인과 쓰기 사이에 행이 밀려도 덮이는 칸을 최소로(보통 비고 · 송장 · DB_SYNC)
 * 4. 쓴 뒤 다시 확인 — 밀렸으면 표시를 남기고 써진 칸 수와 함께 보고(사람 확인)
 * 5. 실패 표시는 **읽은 뒤 주문이 바뀌지 않았을 때(updatedAt 같음)만** 지운다. 웹 쓰기는 `sync` 락을 잡지 않으므로,
 *    그 사이 웹 수정이 있었다면 표시를 남겨 다음 회차가 최신 값으로 다시 맞추게 한다
 * - 건너뛰거나 실패한 주문은 미룬다(지수 백오프 · 프로세스 메모리) — 막힌 주문이 뒤 주문을 가리지 않게
 * - 쓰는 칸: 앱 칸(비고 · 송장번호 · 삭제됨 · 주문유형) · 웹에서 고칠 수 있는 칸 · DB_SYNC_*. 고객 원본 칸(타임스탬프 · 주문자)은 쓰지 않는다
 * - **던지지 않는다** — 결과로 보고하고 호출자(sync-service)가 알린다
 */

import type { SheetService } from './sheet-service.js';
import type { DatabaseService } from './database-service.js';
import { matchesSheetRow } from './sheet-row-identity.js';
import { formatKstTimestamp } from './sync-status-writer.js';
import { validateProductSelection } from '../types/order.js';
import type { Logger } from './sync-engine.js';

/** 한 회차에 다시 맞추는 최대 주문 수 — 시트 호출은 회차당 읽기 2 · 쓰기 1 */
export const RECONCILE_BATCH_LIMIT = 10;
/** 백오프 중인 주문을 거르고도 상한을 채우도록 후보를 넉넉히 읽는다 */
export const RECONCILE_CANDIDATE_FACTOR = 5;
/** 건너뛴 · 실패한 주문을 다시 시도하기까지 — 5분부터 두 배씩, 최대 1시간 */
export const RECONCILE_BACKOFF_BASE_MS = 5 * 60 * 1000;
export const RECONCILE_BACKOFF_MAX_MS = 60 * 60 * 1000;

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
  productType: string | null;
  quantity5kg: string;
  quantity10kg: string;
  updatedAt: Date;
}

export interface ReconcileResult {
  attempted: number;
  /** 이번 회차에 처리하지 못하고 기다리는 대상 수(백오프 중 · 상한 초과) */
  deferred: number;
  /** 시트를 DB 값으로 맞추고 표시를 지운 행 */
  reconciled: number[];
  /** 시트 행이 그 주문이 아니어서(행 밀림 · 빈 칸) 쓰지 않은 행 */
  skippedIdentity: number[];
  /** 썼는데 직후 행이 바뀐 행 — 그 칸들이 다른 주문 행에 써졌을 수 있다(사람 확인) */
  shiftedAfterWrite: Array<{ rowNumber: number; cells: number }>;
  /** 읽은 뒤 웹 수정으로 주문이 바뀌어 표시를 남긴 행 — 다음 회차가 최신 값으로 */
  stale: number[];
  /** 시트 헤더에 없어 쓰지 못한 칸 이름 */
  missingColumns: string[];
  /** 시트 · DB 오류 (행 번호 0 = 회차 전체) */
  failed: Array<{ rowNumber: number; error: string }>;
}

export interface SheetReconcilerOptions {
  now?: () => number;
}

const ORDER_TYPE_LABEL: Record<string, string> = { gift: '선물', claim: '배송사고', customer: '판매' };

/** 웹 DB 경로는 반대쪽 수량에 '0' 을 넣고 시트 경로는 '' 를 쓴다 — 시트 표기에 맞춘다 */
function sheetQuantity(value: string): string {
  return value === '0' ? '' : value;
}

/**
 * DB 현재 값 → 시트 칸 (SheetService.updateOrder · softDelete · 상태 쓰기와 같은 표기).
 * 상품: 웹에서 바꾼 주문(productType 이 원문 해석과 다름)은 시트 쓰기 경로처럼 productType 을 쓴다.
 * DB_SYNC_AT 은 DB 가 마지막으로 반영된 시각(updatedAt)이다.
 */
export function buildReconcileCells(order: ReconcileOrder): Record<string, string> {
  const parsedProduct = validateProductSelection(order.productSelection).productType;
  const product = order.productType && order.productType !== parsedProduct ? order.productType : order.productSelection;
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
    '상품 선택': product,
    '5kg 수량': sheetQuantity(order.quantity5kg),
    '10kg 수량': sheetQuantity(order.quantity10kg),
    DB_SYNC_STATUS: 'success',
    DB_SYNC_AT: formatKstTimestamp(order.updatedAt),
    DB_SYNC_ID: String(order.id),
  };
}

/** 시트 행이 있는 재조정 대상 */
type Target = ReconcileOrder & { sheetRowNumber: number };

interface PlannedWrite {
  order: Target;
  updates: Record<string, string>;
}

function emptyResult(): ReconcileResult {
  return {
    attempted: 0,
    deferred: 0,
    reconciled: [],
    skippedIdentity: [],
    shiftedAfterWrite: [],
    stale: [],
    missingColumns: [],
    failed: [],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class SheetReconciler {
  /** 주문 id → 다시 시도할 수 있는 시각 · 연속 시도 수 */
  private readonly backoff = new Map<number, { until: number; attempts: number }>();
  private readonly now: () => number;

  constructor(
    private readonly sheetService: Pick<SheetService, 'getRowsWithHeaders' | 'getTimestampsByRows' | 'updateRowsCells'>,
    private readonly databaseService: Pick<DatabaseService, 'getSheetSyncFailedOrders' | 'clearSheetSyncFailureIfUnchanged'>,
    private readonly logger?: Logger,
    options: SheetReconcilerOptions = {}
  ) {
    this.now = options.now ?? (() => Date.now());
  }

  async reconcile(limit: number = RECONCILE_BATCH_LIMIT): Promise<ReconcileResult> {
    const result = emptyResult();
    try {
      await this.run(limit, result);
    } catch (error) {
      // 예상 못 한 오류 — 회차 전체를 실패로 보고한다(던지지 않는다)
      result.failed.push({ rowNumber: 0, error: `reconcile aborted: ${errorMessage(error)}` });
    }
    return this.report(result);
  }

  private async run(limit: number, result: ReconcileResult): Promise<void> {
    const now = this.now();
    const coolingIds = [...this.backoff].filter(([, b]) => b.until > now).map(([id]) => id);
    const candidates: Target[] = (await this.databaseService.getSheetSyncFailedOrders(limit * RECONCILE_CANDIDATE_FACTOR, coolingIds)).flatMap(
      (o) => (o.sheetRowNumber === null ? [] : [{ ...o, sheetRowNumber: o.sheetRowNumber }])
    );
    const ready = candidates.filter((o) => (this.backoff.get(o.id)?.until ?? 0) <= now);
    const orders = ready.slice(0, limit);
    result.deferred = candidates.length - orders.length;
    result.attempted = orders.length;
    if (orders.length === 0) return;

    // 1 · 2 · 3: 헤더 + 행을 새로 읽고, 그 주문인 행만 · 다른 칸만
    let read: { headers: string[]; rows: Map<number, Record<string, string>> };
    try {
      read = await this.sheetService.getRowsWithHeaders(orders.map((o) => o.sheetRowNumber));
    } catch (error) {
      this.failAll(result, orders, `row read failed: ${errorMessage(error)}`);
      return;
    }
    const plans = this.plan(orders, read, result);

    // 4: 쓸 칸이 있는 행만 한 번에 쓴다
    const toWrite = plans.filter((p) => Object.keys(p.updates).length > 0);
    if (toWrite.length > 0) {
      try {
        await this.sheetService.updateRowsCells(toWrite.map((p) => ({ row: p.order.sheetRowNumber, updates: p.updates })));
      } catch (error) {
        this.failAll(result, plans.map((p) => p.order), `sheet write failed: ${errorMessage(error)}`);
        return;
      }
    }

    // 쓴 뒤 확인 — 읽지 못하면 지우지 않는다(다음 회차가 다시 확인하고 맞춘다 · 같은 값이라 멱등)
    let after = new Map<number, string>();
    if (toWrite.length > 0) {
      try {
        after = await this.sheetService.getTimestampsByRows(toWrite.map((p) => p.order.sheetRowNumber));
      } catch (error) {
        this.failAll(result, plans.map((p) => p.order), `post-write row check failed: ${errorMessage(error)}`);
        return;
      }
    }

    // 5: 주문이 그대로일 때만 표시를 지운다 — 주문마다 따로(한 건의 오류가 다른 결과를 버리지 않게)
    for (const { order, updates } of plans) {
      const cells = Object.keys(updates).length;
      if (cells > 0 && !matchesSheetRow(order, after.get(order.sheetRowNumber))) {
        result.shiftedAfterWrite.push({ rowNumber: order.sheetRowNumber, cells });
        this.deferOrder(order.id);
        continue;
      }
      try {
        const cleared = await this.databaseService.clearSheetSyncFailureIfUnchanged(order.id, order.updatedAt);
        if (cleared > 0) {
          result.reconciled.push(order.sheetRowNumber);
          this.backoff.delete(order.id);
        } else {
          result.stale.push(order.sheetRowNumber);
        }
      } catch (error) {
        result.failed.push({ rowNumber: order.sheetRowNumber, error: `clear failed: ${errorMessage(error)}` });
        this.deferOrder(order.id);
      }
    }
  }

  /** 그 주문인 행만 골라 DB 와 다른 칸을 계산한다 */
  private plan(
    orders: Target[],
    read: { headers: string[]; rows: Map<number, Record<string, string>> },
    result: ReconcileResult
  ): PlannedWrite[] {
    const headerSet = new Set(read.headers);
    const missing = new Set<string>();
    const plans: PlannedWrite[] = [];
    for (const order of orders) {
      const sheetRow = read.rows.get(order.sheetRowNumber);
      if (!sheetRow || !matchesSheetRow(order, sheetRow['타임스탬프'])) {
        result.skippedIdentity.push(order.sheetRowNumber);
        this.deferOrder(order.id);
        continue;
      }
      const updates = Object.fromEntries(
        Object.entries(buildReconcileCells(order)).filter(([column, value]) => {
          if (!headerSet.has(column)) {
            missing.add(column);
            return false;
          }
          return (sheetRow[column] ?? '') !== value;
        })
      );
      plans.push({ order, updates });
    }
    result.missingColumns = [...missing];
    return plans;
  }

  private failAll(result: ReconcileResult, orders: Target[], error: string): void {
    for (const o of orders) {
      result.failed.push({ rowNumber: o.sheetRowNumber, error });
      this.deferOrder(o.id);
    }
  }

  private deferOrder(orderId: number): void {
    const attempts = (this.backoff.get(orderId)?.attempts ?? 0) + 1;
    const delay = Math.min(RECONCILE_BACKOFF_BASE_MS * 2 ** (attempts - 1), RECONCILE_BACKOFF_MAX_MS);
    this.backoff.set(orderId, { until: this.now() + delay, attempts });
  }

  private report(result: ReconcileResult): ReconcileResult {
    if (result.attempted === 0 && result.failed.length === 0) return result;
    const summary = { ...result };
    if (result.shiftedAfterWrite.length > 0) {
      this.logger?.error(summary, 'Sheet reconcile: rows shifted right after writing — cells may be on other orders (#231)');
    } else if (result.failed.length > 0 || result.skippedIdentity.length > 0 || result.missingColumns.length > 0) {
      this.logger?.warn(summary, 'Sheet reconcile: some rows not reconciled (#231)');
    } else {
      this.logger?.info(
        summary,
        result.stale.length > 0
          ? `Sheet reconcile completed (${result.stale.length} stale — retry next cycle) (#231)`
          : 'Sheet reconcile completed (#231)'
      );
    }
    return result;
  }
}
