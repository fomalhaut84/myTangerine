/**
 * 수동 동기화 결과 표시 판정 (#279)
 *
 * 수동 동기화는 cron 과 달리 #hermes 경고를 보내지 않으므로 화면이 정지 · 재조정 대기의 유일한 신호다.
 * - error: 행 정체성 정지 · 행 밀림 정지 — 사람이 운영 런북으로 확인해야 한다
 * - warning: 행 실패 · 재조정 대기(#228 — 시트 우선 가져오기가 DB 전용 변경 때문에 덮지 않은 행)
 * 이전 API(새 필드 없음) 응답도 받아들인다.
 */

export interface SyncResponse {
  success: boolean;
  message: string;
  /** 재조정 대기 · 정지가 있었다 (#279) */
  warning?: boolean;
  result: {
    total: number;
    success: number;
    failed: number;
    skipped: number;
    errors: Array<{ rowNumber: number; error: string }>;
    newOrderNotices?: number;
    replaced?: number;
    replacementLimitHit?: boolean;
    identityConflictRows?: number[];
    rowShiftDetected?: boolean;
    unprocessed?: number;
    /** #281: DB 를 바꾸지 않고 둔 기존 주문 수 */
    unchanged?: number;
    /** #281: 시트 값이 DB 와 달라 DB 를 유지한 행 */
    sheetDivergedRows?: number[];
    /** #228: 시트 우선 가져오기가 DB 전용 변경(시트 반영 실패) 때문에 덮어쓰지 않은 행 — 재조정 대기 */
    pendingReconcileRows?: number[];
    duration?: number;
  };
}

export type SyncTone = 'success' | 'warning' | 'error';

export interface SyncSummary {
  tone: SyncTone;
  /** 메시지 아래에 한 줄씩 보여 줄 상세 */
  details: string[];
}

const MAX_LISTED_ROWS = 10;

function listRows(rows: readonly number[]): string {
  const shown = rows.slice(0, MAX_LISTED_ROWS).join(', ');
  const rest = rows.length - MAX_LISTED_ROWS;
  return rest > 0 ? `${shown} 외 ${rest}개` : shown;
}

export function summarizeSyncResult(response: SyncResponse): SyncSummary {
  const r = response.result;
  const stalledRows = r.identityConflictRows ?? [];
  const pendingRows = r.pendingReconcileRows ?? [];
  const stopped = r.rowShiftDetected === true || stalledRows.length > 0;
  // 멈춘 행은 errors 에도 들어 있다 — 한 번만 보여 준다
  const otherFailedRows = r.errors.map((e) => e.rowNumber).filter((n) => !stalledRows.includes(n));

  const details = [
    ...(r.rowShiftDetected ? [`시트 행 순서가 바뀌어 멈춤 — 남은 ${r.unprocessed ?? 0}행은 처리하지 않았습니다`] : []),
    ...(stalledRows.length > 0 ? [`멈춘 행: ${listRows(stalledRows)}`] : []),
    ...(pendingRows.length > 0 ? [`시트 반영 대기라 덮어쓰지 않은 행(자동 재조정): ${listRows(pendingRows)}`] : []),
    ...(otherFailedRows.length > 0 ? [`실패한 행: ${listRows(otherFailedRows)}`] : []),
    // #281: 정보 — 정본은 DB 라 시트 값과 달라도 DB 를 유지했다(표시 강도는 바꾸지 않는다)
    ...((r.sheetDivergedRows ?? []).length > 0
      ? [`시트 값이 DB 와 달라 DB 값을 유지한 행: ${listRows(r.sheetDivergedRows ?? [])}`]
      : []),
  ];

  const tone: SyncTone = stopped
    ? 'error'
    : pendingRows.length > 0 || r.failed > 0 || r.errors.length > 0
      ? 'warning'
      : 'success';

  return { tone, details };
}
