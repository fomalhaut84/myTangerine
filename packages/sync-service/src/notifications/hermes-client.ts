/**
 * hermes 클라이언트 (#251 · pleiades 014-hermes §2)
 *
 * 응답 분류 — 예외를 던지지 않는다:
 * - accepted:      202 (중복 키 202 포함) → 끝
 * - rejected:      400 · 413 → 고치기 전에는 재시도하지 않는다
 * - key-rejected:  401(키 없음·틀림) · 403(출처 꺼짐·만료) → 재시도하지 않는다
 * - halt:          429 · 5xx · 그 밖의 코드 · 연결 실패 · 시간 초과 → 같은 Idempotency-Key 로 나중에 재시도
 */

import type { HermesMessage } from './new-order-message.js';

export const HERMES_TIMEOUT_MS = 5000;

export type HermesOutcome =
  | { kind: 'accepted' }
  | { kind: 'rejected'; status: number }
  | { kind: 'key-rejected'; status: number }
  | { kind: 'halt'; reason: 'status' | 'network' | 'timeout'; status?: number; retryAfterSec?: number };

export interface HermesTarget {
  url: string;
  key: string;
}

export interface SendOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const sec = Number.parseInt(value, 10);
  return Number.isFinite(sec) && sec >= 0 ? sec : undefined;
}

function classify(response: Response): HermesOutcome {
  const { status } = response;
  if (status === 202) return { kind: 'accepted' };
  if (status === 400 || status === 413) return { kind: 'rejected', status };
  if (status === 401 || status === 403) return { kind: 'key-rejected', status };
  if (status === 429) {
    return { kind: 'halt', reason: 'status', status, retryAfterSec: parseRetryAfter(response.headers.get('Retry-After')) };
  }
  return { kind: 'halt', reason: 'status', status };
}

export async function sendHermesMessage(
  target: HermesTarget,
  message: HermesMessage,
  idempotencyKey: string,
  options: SendOptions = {}
): Promise<HermesOutcome> {
  const fetchFn = options.fetch ?? fetch;
  try {
    const response = await fetchFn(target.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${target.key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(options.timeoutMs ?? HERMES_TIMEOUT_MS),
    });
    // 본문은 읽지 않는다(로그에 남길 것도 없다) — 연결을 놓아 준다
    await response.body?.cancel().catch(() => undefined);
    return classify(response);
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return { kind: 'halt', reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network' };
  }
}
