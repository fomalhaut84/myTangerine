/**
 * hybrid 쓰기 결과·오류 (#197)
 *
 * 정책 — **DB 우선**:
 * - DB 쓰기가 실패하면 시트에 쓰지 않고 HybridWriteError(503). DB 쓰기는 트랜잭션이라 DB 도 바뀌지 않는다
 *   → "시트만 반영된" 상태(증분 동기화로 DB 에 회복되지 않는다)를 만들지 않는다
 * - DB 성공 · 시트 실패면 성공으로 응답하되 partial + warnings 를 돌려주고 Order.syncStatus='failed' 를 남긴다
 *   → DB 가 앞선 상태는 동기화가 충돌로 분류해 덮어쓰지 않으므로 안정적이다. 시트는 수동으로 맞춘다
 */

export interface WriteOutcome {
  /** DB 에는 반영됐지만 시트 반영이 실패했다 */
  partial: boolean;
  /** 사용자에게 보여 줄 경고 문구 */
  warnings: string[];
}

export function writeOk(): WriteOutcome {
  return { partial: false, warnings: [] };
}

export const SHEET_SYNC_WARNING =
  'DB 에는 저장됐지만 구글 시트 반영에 실패했습니다. 시트를 직접 확인해 주세요.';

export function sheetPartial(): WriteOutcome {
  return { partial: true, warnings: [SHEET_SYNC_WARNING] };
}

export type FailedStore = 'database';

/**
 * hybrid 쓰기에서 DB 가 실패해 아무것도 바꾸지 않았다.
 * statusCode 는 Fastify 오류 처리기가 그대로 응답 코드로 쓴다(5xx 는 일반 문구로 바뀐다).
 */
export class HybridWriteError extends Error {
  readonly statusCode = 503;
  readonly failedStore: FailedStore = 'database';

  constructor(
    readonly operation: string,
    readonly dbError: unknown
  ) {
    super(`Hybrid ${operation} failed in database — nothing was written: ${describeError(dbError)}`);
    this.name = 'HybridWriteError';
  }
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
