/**
 * 로그아웃 버튼 (#219)
 */

'use client';

import { useState } from 'react';
import { LogOut } from 'lucide-react';

/**
 * 예전 서비스워커와 그것이 남긴 화면·응답 캐시를 지운다 — 로그아웃 뒤 개인정보가 남지 않도록.
 * 현재 빌드(Turbopack)는 서비스워커를 만들지 않지만, 예전 webpack 빌드로 설치된 것이 브라우저에 남아 있을 수 있다.
 */
async function clearOfflineData(): Promise<void> {
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }
  if (typeof caches !== 'undefined') {
    const names = await caches.keys();
    await Promise.all(names.map((name) => caches.delete(name)));
  }
}

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
    try {
      await clearOfflineData();
    } catch (error) {
      console.error('[auth] 오프라인 데이터 삭제 실패', error);
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
