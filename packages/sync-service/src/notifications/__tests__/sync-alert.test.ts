/**
 * 동기화 정지 경고 (#260)
 *
 * - 행 안전 정지(행 정체성 충돌 · 교체 상한)가 있으면 `#hermes` 로 warn — 행 번호만 · 하루 1회(Idempotency-Key 날짜)
 * - 동기화 전체가 연속 5회 이상 실패하면 warn — 하루 1회 · 오류 원문은 넣지 않는다
 * - 성공 회차가 오면 연속 실패 수를 0 으로
 * - hermes 가 키를 거부하면(401·403) 이 프로세스에서 더 보내지 않는다 · 어떤 오류도 던지지 않는다
 *
 * hermes 는 mock 이다(S-4).
 */

import { describe, it, expect, vi } from 'vitest';
import { SyncAlerter, buildSyncStallMessage, buildSyncFailureMessage, kstDateKey } from '../sync-alert.js';

const NOW = new Date('2026-11-19T16:30:00Z'); // KST 11-20 01:30
const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

function alerter(send = vi.fn().mockResolvedValue({ kind: 'accepted' }), extra: Partial<ConstructorParameters<typeof SyncAlerter>[0]> = {}) {
  const log = logger();
  const a = new SyncAlerter({
    send,
    logger: log,
    adminWebUrl: 'https://admin.example.com',
    now: () => NOW,
    ...extra,
  });
  return { a, send, log };
}

describe('kstDateKey', () => {
  it('한국 날짜로 자른다', () => {
    expect(kstDateKey(NOW)).toBe('2026-11-20');
    expect(kstDateKey(new Date('2026-11-19T14:59:59Z'))).toBe('2026-11-19');
  });
});

describe('메시지', () => {
  it('정지: 행 번호만 · 많으면 줄임 · 관리 화면 링크 · warn', () => {
    const msg = buildSyncStallMessage([391, 392, 393, 394, 395, 396, 397], 'https://admin.example.com');
    expect(msg).toEqual({
      title: '동기화 정지',
      text: '시트 행 확인(행 순서 불일치 · 교체 상한)으로 동기화하지 못한 행 7건 (행 391, 392, 393, 394, 395 외 2건) — 시트 행 순서를 확인해 주세요.',
      link: { label: '주문 목록', url: 'https://admin.example.com/orders' },
      level: 'warn',
    });
  });

  it('실패: 횟수만 · 오류 원문 없음 · 링크 없으면 생략', () => {
    expect(buildSyncFailureMessage(5, undefined)).toEqual({
      title: '동기화 실패',
      text: '시트 → DB 동기화가 5회 연속 실패했습니다 — 서버 로그 · DB · 구글 시트 접근을 확인해 주세요.',
      level: 'warn',
    });
  });
});

describe('SyncAlerter.onSyncResult — 행 안전 정지', () => {
  it('정지 행이 있으면 하루 1회 키로 보낸다', async () => {
    const { a, send } = alerter();
    await a.onSyncResult({ identityConflictRows: [391] });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].title).toBe('동기화 정지');
    expect(send.mock.calls[0][1]).toBe('sync-stall-2026-11-20');
  });

  it('같은 날 다시 와도 이 프로세스에서는 한 번만 보낸다(매분 반복 정지)', async () => {
    const { a, send } = alerter();
    await a.onSyncResult({ identityConflictRows: [391] });
    await a.onSyncResult({ identityConflictRows: [391, 392] });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('정지 행이 없으면 보내지 않는다', async () => {
    const { a, send } = alerter();
    await a.onSyncResult({ identityConflictRows: [] });
    expect(send).not.toHaveBeenCalled();
  });

  it('보내기가 재시도 대상(halt)이면 다음 회차에 다시 시도한다', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ kind: 'halt', reason: 'network' })
      .mockResolvedValueOnce({ kind: 'accepted' });
    const { a } = alerter(send);
    await a.onSyncResult({ identityConflictRows: [391] });
    await a.onSyncResult({ identityConflictRows: [391] });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][1]).toBe('sync-stall-2026-11-20');
  });
});

describe('SyncAlerter.onSyncFailure — 동기화 전체 실패', () => {
  it('연속 5회째에 하루 1회 키로 보낸다 · 그 전에는 보내지 않는다', async () => {
    const { a, send } = alerter();
    for (let i = 0; i < 4; i++) await a.onSyncFailure();
    expect(send).not.toHaveBeenCalled();
    await a.onSyncFailure();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].title).toBe('동기화 실패');
    expect(send.mock.calls[0][1]).toBe('sync-failure-2026-11-20');
    await a.onSyncFailure();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('성공 회차가 오면 연속 수를 0 으로', async () => {
    const { a, send } = alerter();
    for (let i = 0; i < 4; i++) await a.onSyncFailure();
    await a.onSyncResult({ identityConflictRows: [] });
    for (let i = 0; i < 4; i++) await a.onSyncFailure();
    expect(send).not.toHaveBeenCalled();
  });
});

describe('SyncAlerter — 키 거부 · 오류', () => {
  it('키가 거부되면(401·403) 이후 보내지 않는다 · 오류 로그 1회', async () => {
    const send = vi.fn().mockResolvedValue({ kind: 'key-rejected', status: 403 });
    const { a, log } = alerter(send);
    await a.onSyncResult({ identityConflictRows: [391] });
    for (let i = 0; i < 6; i++) await a.onSyncFailure();
    expect(send).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('신규 주문 알림이 이미 키 거부로 멈췄으면(isActive=false) 보내지 않는다', async () => {
    const { a, send } = alerter(undefined, { isActive: () => false });
    await a.onSyncResult({ identityConflictRows: [391] });
    expect(send).not.toHaveBeenCalled();
  });

  it('보내기가 예외를 던져도 삼키고 로그만 남긴다', async () => {
    const send = vi.fn().mockRejectedValue(new Error('boom'));
    const { a, log } = alerter(send);
    await expect(a.onSyncResult({ identityConflictRows: [391] })).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalled();
  });
});

describe('SyncAlerter.onReconcileResult — 시트 재조정 (#231)', () => {
  const ok = { attempted: 2, reconciled: [10, 11], skippedIdentity: [], shiftedAfterWrite: [], stale: [], failed: [] };

  it('모두 맞췄으면 보내지 않는다', async () => {
    const { a, send } = alerter();
    await a.onReconcileResult(ok);
    expect(send).not.toHaveBeenCalled();
  });

  it('행이 어긋나 쓰지 못했거나 쓴 직후 바뀌었으면 하루 1회 경고 — 행 번호만', async () => {
    const { a, send } = alerter();
    await a.onReconcileResult({ ...ok, skippedIdentity: [12], shiftedAfterWrite: [13] });
    await a.onReconcileResult({ ...ok, skippedIdentity: [12] });
    expect(send).toHaveBeenCalledTimes(1);
    const [msg, key] = send.mock.calls[0];
    expect(key).toBe('sheet-reconcile-stall-2026-11-20');
    expect(msg).toMatchObject({ title: '시트 재조정 정지', level: 'warn' });
    expect(msg.text).toContain('행 12, 13');
  });

  it('쓰기 실패가 연속 5회면 하루 1회 경고 · 성공하면 연속 수를 0 으로', async () => {
    const { a, send } = alerter();
    const failing = { ...ok, reconciled: [], failed: [{ rowNumber: 10, error: 'quota' }] };
    for (let i = 0; i < 4; i++) await a.onReconcileResult(failing);
    expect(send).not.toHaveBeenCalled();
    await a.onReconcileResult(ok);
    for (let i = 0; i < 4; i++) await a.onReconcileResult(failing);
    expect(send).not.toHaveBeenCalled();
    await a.onReconcileResult(failing);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toBe('sheet-reconcile-failure-2026-11-20');
    expect(send.mock.calls[0][0].text).not.toContain('quota'); // 오류 원문은 넣지 않는다
  });

  it('대상이 없던 회차(attempted 0)는 연속 실패 수를 바꾸지 않는다', async () => {
    const { a, send } = alerter();
    const failing = { ...ok, reconciled: [], failed: [{ rowNumber: 10, error: 'x' }] };
    for (let i = 0; i < 4; i++) await a.onReconcileResult(failing);
    await a.onReconcileResult({ ...ok, attempted: 0, reconciled: [] });
    await a.onReconcileResult(failing);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
