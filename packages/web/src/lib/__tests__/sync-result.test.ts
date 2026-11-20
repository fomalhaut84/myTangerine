/**
 * 수동 동기화 결과 표시 판정 (#279)
 * 수동 동기화는 #hermes 경고를 보내지 않으므로 화면이 정지 · 재조정 대기를 경고로 보여야 한다.
 */
import { describe, it, expect } from 'vitest';
import { summarizeSyncResult, type SyncResponse } from '../sync-result';

function response(overrides: Partial<SyncResponse['result']> = {}, warning?: boolean): SyncResponse {
  return {
    success: true,
    message: '동기화 완료',
    ...(warning !== undefined ? { warning } : {}),
    result: { total: 3, success: 3, failed: 0, skipped: 0, errors: [], ...overrides },
  };
}

describe('summarizeSyncResult', () => {
  it('문제 없으면 success · 상세 없음', () => {
    expect(summarizeSyncResult(response())).toEqual({ tone: 'success', details: [] });
  });

  it('행 실패만 있으면 warning · 실패 행 목록', () => {
    const s = summarizeSyncResult(response({ failed: 1, errors: [{ rowNumber: 5, error: 'Sync failed for this row' }] }));
    expect(s.tone).toBe('warning');
    expect(s.details).toContain('실패한 행: 5');
  });

  it('행 밀림 정지면 error(가장 강한 경고) · 정지 행과 남은 행 수', () => {
    const s = summarizeSyncResult(
      response({ failed: 2, rowShiftDetected: true, unprocessed: 30, identityConflictRows: [11, 12] }, true)
    );
    expect(s.tone).toBe('error');
    expect(s.details).toContain('시트 행 순서가 바뀌어 멈춤 — 남은 30행은 처리하지 않았습니다');
    expect(s.details).toContain('멈춘 행: 11, 12');
  });

  it('행 정체성 정지만 있어도 error', () => {
    const s = summarizeSyncResult(response({ failed: 1, identityConflictRows: [391] }, true));
    expect(s.tone).toBe('error');
    expect(s.details).toContain('멈춘 행: 391');
  });

  it('멈춘 행은 실패 목록에 다시 나오지 않는다', () => {
    const s = summarizeSyncResult(
      response({ failed: 2, identityConflictRows: [391], errors: [{ rowNumber: 391, error: 'x' }, { rowNumber: 5, error: 'x' }] }, true)
    );
    expect(s.details).toContain('실패한 행: 5');
    expect(s.details.filter((d) => d.includes('391'))).toHaveLength(1);
  });

  it('#228: 재조정 대기 행(시트 우선 가져오기가 덮지 않음)은 warning · 행 목록', () => {
    const s = summarizeSyncResult(response({ pendingReconcileRows: [7, 9] }, true));
    expect(s.tone).toBe('warning');
    expect(s.details).toContain('시트 반영 대기라 덮어쓰지 않은 행(자동 재조정): 7, 9');
    expect(s.details.some((d) => d.includes('충돌'))).toBe(false);
  });

  it('행 목록은 10개까지만 보이고 나머지는 개수로', () => {
    const rows = Array.from({ length: 13 }, (_, i) => i + 1);
    const s = summarizeSyncResult(response({ identityConflictRows: rows }, true));
    expect(s.details).toContain('멈춘 행: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 외 3개');
  });

  it('#281: 시트와 다른 행(DB 유지)은 정보로만 보여 준다(표시 강도는 그대로)', () => {
    const s = summarizeSyncResult(response({ unchanged: 2, sheetDivergedRows: [12, 13] }));
    expect(s.tone).toBe('success');
    expect(s.details).toContain('시트 값이 DB 와 달라 DB 값을 유지한 행: 12, 13');
  });

  it('이전 API(새 필드 없음) 응답도 깨지지 않는다', () => {
    expect(summarizeSyncResult(response()).tone).toBe('success');
  });
});
