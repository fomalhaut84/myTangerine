/**
 * 로그아웃 버튼 (#219)
 */

'use client';

import { useState } from 'react';
import { LogOut } from 'lucide-react';

export function LogoutButton() {
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    try {
      await fetch('/auth/logout', { method: 'POST' });
    } catch (error) {
      // 쿠키 삭제에 실패해도 로그인 화면으로 보낸다 — 세션이 남아 있으면 그곳에서 다시 들어온다
      console.error('[auth] 로그아웃 요청 실패', error);
    }
    window.location.assign('/login');
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-label="로그아웃"
      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors duration-200 disabled:opacity-50"
    >
      <LogOut className="h-4 w-4" />
      <span className="hidden sm:inline" aria-hidden="true">
        로그아웃
      </span>
    </button>
  );
}
