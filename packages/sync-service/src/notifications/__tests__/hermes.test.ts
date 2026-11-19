/**
 * hermes 신규 주문 알림 (#251)
 *
 * - 설정: 키가 없으면 꺼진다(표시도 발송도 안 함) · 링크 주소는 https 만
 * - 메시지: 개인정보 없음 · 사용자 문구 · 주문 상세 링크
 * - 클라이언트: 응답 코드별 분류 · Authorization · Idempotency-Key
 * - 발송기: 202 → sent · 400/413 → rejected · 401/403(키 틀림·만료) → 이 프로세스에서 발송·표시 중단
 *   · 그 밖(404 · 429 · 5xx · 연결 실패)은 대기 유지 + 이번 회차 중단 · 보낼 때 24시간 밖이면 expired
 *
 * 네트워크 · DB 는 mock 이다(S-4).
 */

import { describe, it, expect, vi } from 'vitest';
import { loadHermesConfig, DEFAULT_HERMES_URL } from '../hermes-config.js';
import { buildNewOrderMessage, NEW_ORDER_TEXT } from '../new-order-message.js';
import { sendHermesMessage, type HermesOutcome } from '../hermes-client.js';
import { NewOrderNotifier, type NoticeStore } from '../new-order-notifier.js';

const KEY = 'hk_test_0123456789abcdef';

describe('loadHermesConfig', () => {
  it('HERMES_KEY 가 없으면 꺼진다', () => {
    const c = loadHermesConfig({});
    expect(c.enabled).toBe(false);
  });

  it('공백뿐인 키도 없는 것으로 본다', () => {
    expect(loadHermesConfig({ HERMES_KEY: '   ' }).enabled).toBe(false);
  });

  it('키만 있으면 기본 URL 로 켜진다', () => {
    const c = loadHermesConfig({ HERMES_KEY: KEY });
    expect(c).toMatchObject({ enabled: true, url: DEFAULT_HERMES_URL, key: KEY });
    expect(DEFAULT_HERMES_URL).toBe('http://127.0.0.1:4700/v1/messages');
  });

  it('HERMES_URL 이 http(s) 가 아니면 꺼진다', () => {
    expect(loadHermesConfig({ HERMES_KEY: KEY, HERMES_URL: 'ftp://x/y' }).enabled).toBe(false);
    expect(loadHermesConfig({ HERMES_KEY: KEY, HERMES_URL: 'not a url' }).enabled).toBe(false);
  });

  it('http 는 루프백만 · 원격은 https 만 (키 평문 전송 방지)', () => {
    expect(loadHermesConfig({ HERMES_KEY: KEY, HERMES_URL: 'http://localhost:4700/v1/messages' }).enabled).toBe(true);
    expect(loadHermesConfig({ HERMES_KEY: KEY, HERMES_URL: 'http://[::1]:4700/v1/messages' }).enabled).toBe(true);
    expect(loadHermesConfig({ HERMES_KEY: KEY, HERMES_URL: 'http://hermes.example.com/v1/messages' }).enabled).toBe(false);
    expect(loadHermesConfig({ HERMES_KEY: KEY, HERMES_URL: 'https://hermes.example.com/v1/messages' }).enabled).toBe(true);
  });

  it('ADMIN_WEB_URL 은 https 만 받고 끝 / 를 뗀다', () => {
    const ok = loadHermesConfig({ HERMES_KEY: KEY, ADMIN_WEB_URL: 'https://admin.example.com/' });
    expect(ok).toMatchObject({ enabled: true, adminWebUrl: 'https://admin.example.com' });
    const http = loadHermesConfig({ HERMES_KEY: KEY, ADMIN_WEB_URL: 'http://admin.example.com' });
    expect(http).toMatchObject({ enabled: true, adminWebUrl: undefined });
    expect(http.enabled && http.warnings.join(' ')).toContain('ADMIN_WEB_URL');
  });

  it('설정 결과에 키 값이 경고 문구로 새지 않는다', () => {
    const c = loadHermesConfig({ HERMES_KEY: KEY, HERMES_URL: 'bad' });
    expect(JSON.stringify(c)).not.toContain(KEY);
  });
});

describe('buildNewOrderMessage', () => {
  it('사용자 문구 + 주문 상세 링크(시트 행 번호)', () => {
    expect(buildNewOrderMessage(15, 'https://admin.example.com')).toEqual({
      title: '새 주문',
      text: '신규 주문이 추가되었습니다.',
      link: { label: '주문 상세', url: 'https://admin.example.com/orders/15' },
      level: 'info',
    });
    expect(NEW_ORDER_TEXT).toBe('신규 주문이 추가되었습니다.');
  });

  it('관리 화면 주소가 없으면 링크 없이', () => {
    expect(buildNewOrderMessage(15, undefined)).toEqual({ title: '새 주문', text: NEW_ORDER_TEXT, level: 'info' });
  });
});

function fakeFetch(status: number, headers: Record<string, string> = {}) {
  return vi.fn().mockResolvedValue(new Response(status === 202 ? '{"id":"x","duplicate":false}' : '{}', { status, headers }));
}

describe('sendHermesMessage', () => {
  const target = { url: DEFAULT_HERMES_URL, key: KEY };
  const message = buildNewOrderMessage(15, 'https://admin.example.com');

  it('요청 형식: POST · Bearer · Idempotency-Key · JSON 본문', async () => {
    const fetchFn = fakeFetch(202);
    await sendHermesMessage(target, message, 'order-7', { fetch: fetchFn, timeoutMs: 1000 });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(DEFAULT_HERMES_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'order-7',
    });
    expect(JSON.parse(init.body)).toEqual(message);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each<[number, HermesOutcome['kind']]>([
    [202, 'accepted'],
    [400, 'rejected'],
    [413, 'rejected'],
    [401, 'key-rejected'],
    [403, 'key-rejected'],
    [404, 'halt'],
    [429, 'halt'],
    [500, 'halt'],
    [503, 'halt'],
  ])('%i → %s', async (status, kind) => {
    const out = await sendHermesMessage(target, message, 'order-7', { fetch: fakeFetch(status), timeoutMs: 1000 });
    expect(out.kind).toBe(kind);
  });

  it('429 는 Retry-After 를 함께 돌려준다', async () => {
    const out = await sendHermesMessage(target, message, 'order-7', {
      fetch: fakeFetch(429, { 'Retry-After': '30' }),
      timeoutMs: 1000,
    });
    expect(out).toMatchObject({ kind: 'halt', status: 429, retryAfterSec: 30 });
  });

  it('연결 실패 · 시간 초과는 halt (예외를 던지지 않는다)', async () => {
    const refused = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    expect(await sendHermesMessage(target, message, 'k', { fetch: refused, timeoutMs: 1000 })).toMatchObject({
      kind: 'halt',
      reason: 'network',
    });
    const timeout = vi.fn().mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' }));
    expect(await sendHermesMessage(target, message, 'k', { fetch: timeout, timeoutMs: 1000 })).toMatchObject({
      kind: 'halt',
      reason: 'timeout',
    });
  });
});

const NOW = new Date('2026-11-19T03:00:00.000Z');
const FRESH = new Date(NOW.getTime() - 60_000);
// 운영에서는 index 가 core isWithinNoticeWindow 를 넘긴다 — 여기서는 같은 규칙의 고정 시계
const clock = { isFresh: (ts: Date) => Math.abs(NOW.getTime() - ts.getTime()) <= 24 * 3600_000 };

function store(pending: Array<{ id: number; sheetRowNumber: number; timestamp?: Date }>): NoticeStore & {
  setNewOrderNoticeResult: ReturnType<typeof vi.fn>;
  getPendingNewOrderNotices: ReturnType<typeof vi.fn>;
} {
  return {
    getPendingNewOrderNotices: vi.fn().mockResolvedValue(pending.map((p) => ({ timestamp: FRESH, ...p }))),
    setNewOrderNoticeResult: vi.fn().mockResolvedValue(true),
  };
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe('NewOrderNotifier.flush', () => {
  it('202 → sent · 주문마다 order-<id> 키', async () => {
    const s = store([{ id: 1, sheetRowNumber: 10 }, { id: 2, sheetRowNumber: 11 }]);
    const send = vi.fn().mockResolvedValue({ kind: 'accepted' });
    const n = new NewOrderNotifier({ store: s, send, adminWebUrl: 'https://a.example.com', logger, ...clock });
    const r = await n.flush();
    expect(r).toEqual({ sent: 2, rejected: 0, expired: 0, halted: false });
    expect(send.mock.calls.map((c) => c[1])).toEqual(['order-1', 'order-2']);
    expect(send.mock.calls[0][0].link.url).toBe('https://a.example.com/orders/10');
    expect(s.setNewOrderNoticeResult).toHaveBeenCalledWith(1, 'sent');
    expect(s.setNewOrderNoticeResult).toHaveBeenCalledWith(2, 'sent');
  });

  it('400 → rejected 로 기록하고 다음 주문은 계속', async () => {
    const s = store([{ id: 1, sheetRowNumber: 10 }, { id: 2, sheetRowNumber: 11 }]);
    const send = vi
      .fn()
      .mockResolvedValueOnce({ kind: 'rejected', status: 400 })
      .mockResolvedValueOnce({ kind: 'accepted' });
    const r = await new NewOrderNotifier({ store: s, send, logger, ...clock }).flush();
    expect(r).toEqual({ sent: 1, rejected: 1, expired: 0, halted: false });
    expect(s.setNewOrderNoticeResult).toHaveBeenCalledWith(1, 'rejected');
  });

  it('halt(503 · 429 · 연결 실패) → 기록하지 않고(대기 유지) 이번 회차 중단', async () => {
    const s = store([{ id: 1, sheetRowNumber: 10 }, { id: 2, sheetRowNumber: 11 }]);
    const send = vi.fn().mockResolvedValue({ kind: 'halt', status: 503, reason: 'status' });
    const r = await new NewOrderNotifier({ store: s, send, logger, ...clock }).flush();
    expect(r).toEqual({ sent: 0, rejected: 0, expired: 0, halted: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(s.setNewOrderNoticeResult).not.toHaveBeenCalled();
  });

  it('401·403(키 틀림·만료) → 기록하지 않고 이 프로세스에서 발송·표시를 멈춘다 · 오류 로그 1회', async () => {
    const s = store([{ id: 1, sheetRowNumber: 10 }, { id: 2, sheetRowNumber: 11 }]);
    const send = vi.fn().mockResolvedValue({ kind: 'key-rejected', status: 403 });
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const n = new NewOrderNotifier({ store: s, send, logger: log, ...clock });
    expect(n.isActive()).toBe(true);
    expect(await n.flush()).toEqual({ sent: 0, rejected: 0, expired: 0, halted: true });
    expect(n.isActive()).toBe(false);
    expect(s.setNewOrderNoticeResult).not.toHaveBeenCalled();
    // 다음 회차: 조회·발송 없이 끝
    expect(await n.flush()).toEqual({ sent: 0, rejected: 0, expired: 0, halted: true, skipped: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(s.getPendingNewOrderNotices).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('보낼 때 주문 시각이 24시간 밖이면 보내지 않고 expired', async () => {
    const old = new Date(NOW.getTime() - 25 * 3600_000);
    const s = store([{ id: 1, sheetRowNumber: 10, timestamp: old }, { id: 2, sheetRowNumber: 11 }]);
    const send = vi.fn().mockResolvedValue({ kind: 'accepted' });
    const r = await new NewOrderNotifier({ store: s, send, logger, ...clock }).flush();
    expect(r).toEqual({ sent: 1, rejected: 0, expired: 1, halted: false });
    expect(s.setNewOrderNoticeResult).toHaveBeenCalledWith(1, 'expired');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toBe('order-2');
  });

  it('대기 조회 상한을 넘긴다', async () => {
    const s = store([]);
    await new NewOrderNotifier({ store: s, send: vi.fn(), logger, batchSize: 5, ...clock }).flush();
    expect(s.getPendingNewOrderNotices).toHaveBeenCalledWith(5);
  });

  it('DB 오류는 삼키지 않고 로그를 남기되 던지지 않는다(동기화를 막지 않는다)', async () => {
    const s = store([]);
    s.getPendingNewOrderNotices.mockRejectedValue(new Error('db down'));
    const r = await new NewOrderNotifier({ store: s, send: vi.fn(), logger, ...clock }).flush();
    expect(r).toEqual({ sent: 0, rejected: 0, expired: 0, halted: true });
    expect(logger.error).toHaveBeenCalled();
  });

  it('동시에 두 번 불려도 한 번만 돈다', async () => {
    const s = store([{ id: 1, sheetRowNumber: 10 }]);
    let release: () => void = () => undefined;
    const send = vi.fn().mockImplementation(
      () => new Promise((resolve) => { release = () => resolve({ kind: 'accepted' }); })
    );
    const n = new NewOrderNotifier({ store: s, send, logger, ...clock });
    const first = n.flush();
    const second = await n.flush();
    expect(second).toEqual({ sent: 0, rejected: 0, expired: 0, halted: false, skipped: true });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    release();
    await first;
    expect(send).toHaveBeenCalledTimes(1);
  });
});
