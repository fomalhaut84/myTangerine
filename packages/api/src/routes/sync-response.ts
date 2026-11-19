/**
 * 수동 동기화 응답 (#279)
 *
 * SyncEngine 의 결과(core `SyncResult`)를 웹에 돌려줄 모양으로 바꾼다.
 * - 충돌 · 행 정체성 정지(#257 · #260) · 행 밀림 정지(#261) 를 응답에 남긴다 — 수동 동기화는 #hermes 경고를
 *   보내지 않으므로 화면이 유일한 신호다
 * - 행 오류 · 충돌 사유 문자열은 내부 상세(오류 원문 · 시각)를 담으므로 내보내지 않는다
 *
 * core 는 타입 선언 없이 소비되므로(dist 에 .d.ts 없음) 필요한 모양을 여기서 정의한다.
 * core dist 가 낡아 새 필드가 없더라도 기본값으로 응답한다.
 */

export interface SyncRouteResult {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  conflicts: number;
  errors: Array<{ rowNumber: number; error: string }>;
  conflictDetails: Array<{ rowNumber: number; orderId: number; reason?: string }>;
  newOrderNotices: number;
  replaced: number;
  replacementLimitHit: boolean;
  identityConflictRows: number[];
  rowShiftDetected: boolean;
  unprocessed: number;
  /** #281: 증분이 DB 를 바꾸지 않고 둔 기존 주문 수 */
  unchanged?: number;
  /** #281: 시트 값이 DB 와 달랐지만 DB 를 유지한 행 번호 */
  sheetDivergedRows?: number[];
}

export type SyncMode = 'incremental' | 'full';

export interface SyncResponseBody {
  success: true;
  /** 충돌 · 정지가 있었다 — 화면이 경고로 보여 준다 */
  warning: boolean;
  message: string;
  result: {
    total: number;
    success: number;
    failed: number;
    skipped: number;
    conflicts: number;
    conflictDetails: Array<{ rowNumber: number; orderId: number }>;
    errors: Array<{ rowNumber: number; error: string }>;
    newOrderNotices: number;
    replaced: number;
    replacementLimitHit: boolean;
    identityConflictRows: number[];
    rowShiftDetected: boolean;
    unprocessed: number;
    unchanged: number;
    sheetDivergedRows: number[];
    duration?: number;
  };
}

const GENERIC_ROW_ERROR = 'Sync failed for this row';

export function buildSyncResponse(result: SyncRouteResult, mode: SyncMode, durationSec?: number): SyncResponseBody {
  const conflicts = result.conflicts ?? 0;
  const identityConflictRows = [...(result.identityConflictRows ?? [])];
  const rowShiftDetected = result.rowShiftDetected === true;
  const unprocessed = result.unprocessed ?? 0;

  const body: SyncResponseBody['result'] = {
    total: result.total,
    success: result.success,
    failed: result.failed,
    skipped: result.skipped,
    conflicts,
    conflictDetails: (result.conflictDetails ?? []).map(({ rowNumber, orderId }) => ({ rowNumber, orderId })),
    errors: (result.errors ?? []).map(({ rowNumber }) => ({ rowNumber, error: GENERIC_ROW_ERROR })),
    newOrderNotices: result.newOrderNotices ?? 0,
    replaced: result.replaced ?? 0,
    replacementLimitHit: result.replacementLimitHit === true,
    identityConflictRows,
    rowShiftDetected,
    unprocessed,
    unchanged: result.unchanged ?? 0,
    sheetDivergedRows: [...(result.sheetDivergedRows ?? [])],
    ...(durationSec !== undefined ? { duration: durationSec } : {}),
  };

  return {
    success: true,
    warning: conflicts > 0 || rowShiftDetected || identityConflictRows.length > 0,
    message: buildMessage(body, mode),
    result: body,
  };
}

function buildMessage(r: SyncResponseBody['result'], mode: SyncMode): string {
  const label = mode === 'full' ? '전체 동기화 완료' : '동기화 완료';
  const parts = [`${label}: ${r.success}개 성공, ${r.failed}개 실패, ${r.skipped}개 건너뜀`];
  if (r.unchanged > 0) parts[0] += `, 기존 주문 유지 ${r.unchanged}개`;
  if (r.conflicts > 0) parts[0] += `, 충돌 ${r.conflicts}건`;
  if (r.duration !== undefined) parts[0] += ` (소요 시간: ${r.duration}초)`;

  if (r.rowShiftDetected) {
    parts.push(
      `시트 행 순서가 바뀌어 동기화를 멈췄습니다(남은 ${r.unprocessed}행). 운영 런북(시트 · 동기화 운영)을 확인하세요.`
    );
  } else if (r.identityConflictRows.length > 0) {
    parts.push(`행 ${r.identityConflictRows.length}개는 시트와 DB 주문이 맞지 않아 쓰지 않았습니다. 운영 런북을 확인하세요.`);
  }
  if (r.conflicts > 0) {
    parts.push('충돌은 DB 에만 있는 변경(웹 수정 · 시트 반영 실패)이라 시트 값으로 덮어쓰지 않은 것입니다.');
  }
  if (r.sheetDivergedRows.length > 0) {
    parts.push(`행 ${r.sheetDivergedRows.length}개는 시트 값이 DB 와 달라 DB 값을 유지했습니다(정본 = DB).`);
  }
  return parts.join(' — ');
}

const rowErrorSchema = {
  type: 'object',
  properties: { rowNumber: { type: 'number' }, error: { type: 'string' } },
} as const;

/** POST /api/sync[/full] 200 응답 스키마 — 선언하지 않은 필드는 직렬화에서 사라진다 */
export function syncResponseSchema(full: boolean) {
  return {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      warning: { type: 'boolean', description: '충돌 · 행 정체성 정지 · 행 밀림 정지가 있었다 (#279)' },
      message: { type: 'string' },
      result: {
        type: 'object',
        properties: {
          total: { type: 'number', description: '전체 행 수' },
          success: { type: 'number', description: '성공한 행 수' },
          failed: { type: 'number', description: '실패한 행 수' },
          skipped: {
            type: 'number',
            description: full ? '건너뛴 행 수 (rowNumber 없음)' : '건너뛴 행 수 (이미 동기화됨)',
          },
          conflicts: { type: 'number', description: '웹 수정과 충돌해 덮어쓰지 않은 행 수' },
          conflictDetails: {
            type: 'array',
            items: { type: 'object', properties: { rowNumber: { type: 'number' }, orderId: { type: 'number' } } },
          },
          errors: { type: 'array', items: rowErrorSchema },
          newOrderNotices: { type: 'number', description: '신규 주문 알림 대기로 표시한 수 (#251)' },
          replaced: { type: 'number', description: '행 재사용으로 교체한 주문 수 (#257)' },
          replacementLimitHit: { type: 'boolean', description: '교체 상한에 걸린 행이 있었다 (#257)' },
          identityConflictRows: {
            type: 'array',
            items: { type: 'number' },
            description: '시트 행 · DB 주문 정체성이 맞지 않아 쓰지 않은 행 번호 (#257 · #260 · #261)',
          },
          rowShiftDetected: { type: 'boolean', description: '시트 행이 밀려 이번 실행을 멈췄다 (#261)' },
          unprocessed: { type: 'number', description: '멈춰서 처리하지 못한 행 수 (#261)' },
          unchanged: { type: 'number', description: 'DB 를 바꾸지 않고 둔 기존 주문 수 (#281)' },
          sheetDivergedRows: {
            type: 'array',
            items: { type: 'number' },
            description: '시트 값이 DB 와 달라 DB 를 유지한 행 번호 (#281 · 정본 = DB)',
          },
          ...(full ? { duration: { type: 'number', description: '소요 시간 (초)' } } : {}),
        },
      },
    },
  };
}
