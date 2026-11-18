/**
 * 로그인 시도 제한 (#219) — 클라이언트(IP)별 실패 횟수를 창(window) 단위로 센다.
 *
 * 메모리 저장이라 웹 프로세스가 재시작되면 초기화된다(단일 pm2 인스턴스 전제).
 */

export interface LoginThrottleOptions {
  maxFailures: number;
  windowMs: number;
  /** 추적하는 클라이언트 수 상한 — 넘으면 가장 오래된 항목부터 버린다 */
  maxClients?: number;
}

interface Entry {
  readonly failures: number;
  readonly windowStart: number;
}

const DEFAULT_MAX_CLIENTS = 10_000;

export class LoginThrottle {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly options: LoginThrottleOptions) {}

  get size(): number {
    return this.entries.size;
  }

  private current(client: string, nowMs: number): Entry | undefined {
    const entry = this.entries.get(client);
    if (!entry) return undefined;
    if (nowMs - entry.windowStart >= this.options.windowMs) {
      this.entries.delete(client);
      return undefined;
    }
    return entry;
  }

  isBlocked(client: string, nowMs: number = Date.now()): boolean {
    const entry = this.current(client, nowMs);
    return entry !== undefined && entry.failures >= this.options.maxFailures;
  }

  recordFailure(client: string, nowMs: number = Date.now()): void {
    const entry = this.current(client, nowMs);
    const next: Entry = entry
      ? { failures: entry.failures + 1, windowStart: entry.windowStart }
      : { failures: 1, windowStart: nowMs };

    // 삽입 순서를 갱신해 오래된 항목이 앞에 오게 한다
    this.entries.delete(client);
    this.entries.set(client, next);

    const max = this.options.maxClients ?? DEFAULT_MAX_CLIENTS;
    while (this.entries.size > max) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  recordSuccess(client: string): void {
    this.entries.delete(client);
  }
}

/**
 * 클라이언트 IP — 리버스 프록시가 덧붙인 X-Forwarded-For 의 **마지막** 값.
 * 앞쪽 값은 클라이언트가 임의로 넣을 수 있다.
 */
export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const last = forwarded
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v !== '')
      .pop();
    if (last) return last;
  }
  return headers.get('x-real-ip')?.trim() || 'unknown';
}

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_MS = 10 * 60 * 1000;

/** 웹 프로세스 전체가 공유하는 인스턴스 */
export const loginThrottle = new LoginThrottle({
  maxFailures: LOGIN_MAX_FAILURES,
  windowMs: LOGIN_WINDOW_MS,
});
