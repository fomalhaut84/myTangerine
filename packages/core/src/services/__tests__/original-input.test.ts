/**
 * 최초 입력값 (#281)
 * 주문이 처음 들어올 때의 폼 입력을 보존한다 — 시트 헤더 → 값, 앱이 쓰는 칸과 내부 키는 뺀다.
 */
import { describe, it, expect } from 'vitest';
import { buildOriginalInput, APP_MANAGED_COLUMNS } from '../original-input.js';
import type { SheetRow } from '../../types/order.js';

const row = {
  _rowNumber: 10,
  _validationError: 'x',
  타임스탬프: '2026. 11. 19. 오전 10:26:32',
  '주문자 성함': '주문자',
  '이메일 주소': 'a@example.com',
  '보내는분 성함': '보내는이',
  '받으실분 성함': '받는이',
  '상품 선택': '5kg',
  '5kg 수량': '1',
  '10kg 수량': '',
  '추가 요청사항': '문 앞에 두세요',
  비고: '입금확인',
  송장번호: '123',
  삭제됨: '',
  주문유형: '선물',
  DB_SYNC_STATUS: 'success',
  DB_SYNC_AT: '2026-11-19T10:00:00+09:00',
  DB_SYNC_ID: '5',
} as unknown as SheetRow;

describe('buildOriginalInput', () => {
  it('폼 칸은 모두 남기고(DB 에 없는 질문 포함) 앱 칸 · 내부 키는 뺀다', () => {
    expect(buildOriginalInput(row)).toEqual({
      타임스탬프: '2026. 11. 19. 오전 10:26:32',
      '주문자 성함': '주문자',
      '이메일 주소': 'a@example.com',
      '보내는분 성함': '보내는이',
      '받으실분 성함': '받는이',
      '상품 선택': '5kg',
      '5kg 수량': '1',
      '10kg 수량': '',
      '추가 요청사항': '문 앞에 두세요',
    });
  });

  it('앱 칸 목록: 비고 · 송장번호 · 삭제됨 · 주문유형(관리자 칸) · DB_SYNC_*', () => {
    expect([...APP_MANAGED_COLUMNS].sort()).toEqual(
      ['DB_SYNC_AT', 'DB_SYNC_ID', 'DB_SYNC_STATUS', '비고', '삭제됨', '송장번호', '주문유형'].sort()
    );
  });

  it('값은 문자열로 · undefined/null 은 빈 문자열', () => {
    const r = { _rowNumber: 1, 타임스탬프: 't', '5kg 수량': 2, '10kg 수량': undefined } as unknown as SheetRow;
    expect(buildOriginalInput(r)).toEqual({ 타임스탬프: 't', '5kg 수량': '2', '10kg 수량': '' });
  });
});
