/**
 * 최초 입력값 섹션 (#281)
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OriginalInputSection } from '../OriginalInputSection';

describe('OriginalInputSection', () => {
  it('접힌 상태로 시작하고 펼치면 칸 이름과 값을 시트 순서대로 보여 준다', () => {
    render(<OriginalInputSection originalInput={{ '받으실분 성함': '처음 받는이', '추가 요청사항': '문 앞에 두세요' }} />);
    expect(screen.queryByText('처음 받는이')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /최초 입력값/ }));
    expect(screen.getByText('받으실분 성함')).toBeTruthy();
    expect(screen.getByText('처음 받는이')).toBeTruthy();
    expect(screen.getByText('추가 요청사항')).toBeTruthy();
  });

  it('빈 값은 (비어 있음) 으로 표시한다', () => {
    render(<OriginalInputSection originalInput={{ '10kg 수량': '' }} />);
    fireEvent.click(screen.getByRole('button', { name: /최초 입력값/ }));
    expect(screen.getByText('(비어 있음)')).toBeTruthy();
  });

  it('이 기능 이전 주문(값 없음)은 안내만 보여 준다', () => {
    render(<OriginalInputSection originalInput={undefined} />);
    expect(screen.getByText(/보관된 최초 입력값이 없습니다/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
