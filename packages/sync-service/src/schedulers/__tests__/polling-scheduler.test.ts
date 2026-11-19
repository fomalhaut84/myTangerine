/**
 * 스케줄러 — 증분 동기화 뒤 시트 재조정 (#231)
 * - 같은 sync 락 안에서 증분 동기화 다음에 돈다
 * - 동기화가 멈춘 회차(행 밀림 · 행 정체성 정지)는 재조정하지 않는다 — 시트가 불안정
 * - 결과는 알림(onReconcileResult)으로 넘긴다 · 재조정이 던져도 동기화 결과 처리는 계속한다
 *
 * 분산 락 · 동기화 · 재조정 · 알림은 mock 이다(S-4).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const lockCalls: string[] = [];
vi.mock('@mytangerine/core', () => ({
  withDistributedLock: vi.fn(async (_prisma: unknown, name: string, _id: string, fn: () => Promise<unknown>) => {
    lockCalls.push(name);
    return fn();
  }),
}));
vi.mock('../../utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { PollingScheduler } from '../polling-scheduler.js';

const baseResult = {
  total: 1, success: 1, failed: 0, skipped: 0, errors: [], newOrderNotices: 0, replaced: 0,
  replacementLimitHit: false, identityConflictRows: [] as number[], rowShiftDetected: false, unprocessed: 0,
};
const reconcileResult = { attempted: 1, reconciled: [10], skippedIdentity: [], shiftedAfterWrite: [], stale: [], failed: [] };

function make(syncResult = baseResult) {
  const order: string[] = [];
  const syncEngine = { incrementalSync: vi.fn(async () => { order.push('sync'); return syncResult; }) };
  const reconciler = { reconcile: vi.fn(async () => { order.push('reconcile'); return reconcileResult; }) };
  const alerter = { onSyncResult: vi.fn(), onSyncFailure: vi.fn(), onReconcileResult: vi.fn(), onReconcileError: vi.fn() };
  const s = new PollingScheduler(syncEngine as never, {} as never, { interval: '* * * * *', enabled: false }, undefined, alerter, reconciler);
  const run = () => (s as unknown as { runSync(): Promise<void> }).runSync();
  return { run, syncEngine, reconciler, alerter, order };
}

beforeEach(() => {
  lockCalls.length = 0;
});

describe('PollingScheduler — 시트 재조정 (#231)', () => {
  it('증분 동기화 다음에 같은 sync 락 안에서 재조정하고 결과를 알림에 넘긴다', async () => {
    const { run, order, alerter } = make();
    await run();
    expect(order).toEqual(['sync', 'reconcile']);
    expect(lockCalls).toEqual(['sync']);
    expect(alerter.onReconcileResult).toHaveBeenCalledWith(reconcileResult);
  });

  it('행 밀림으로 멈춘 회차는 재조정하지 않는다', async () => {
    const { run, reconciler, alerter } = make({ ...baseResult, rowShiftDetected: true });
    await run();
    expect(reconciler.reconcile).not.toHaveBeenCalled();
    expect(alerter.onReconcileResult).not.toHaveBeenCalled();
  });

  it('행 정체성 정지가 있던 회차도 재조정하지 않는다', async () => {
    const { run, reconciler } = make({ ...baseResult, identityConflictRows: [391] });
    await run();
    expect(reconciler.reconcile).not.toHaveBeenCalled();
  });

  it('재조정이 던져도 동기화 결과 알림은 그대로 · 동기화 실패로 세지 않는다', async () => {
    const { run, reconciler, alerter } = make();
    reconciler.reconcile.mockRejectedValue(new Error('boom'));
    await run();
    expect(alerter.onSyncResult).toHaveBeenCalled();
    expect(alerter.onSyncFailure).not.toHaveBeenCalled();
    expect(alerter.onReconcileResult).not.toHaveBeenCalled();
    expect(alerter.onReconcileError).toHaveBeenCalledTimes(1);
  });
});
