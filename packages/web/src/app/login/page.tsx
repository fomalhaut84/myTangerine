/**
 * 관리자 로그인 화면 (#219)
 */

'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { safeNextPath } from '@/lib/auth/redirect';

const FALLBACK_ERROR = '로그인에 실패했습니다. 잠시 후 다시 시도하세요.';

function LoginForm() {
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        // 전체 새로고침으로 이동 — 세션 쿠키를 붙인 요청으로 페이지를 다시 받는다
        window.location.assign(safeNextPath(searchParams.get('next')));
        return;
      }
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(body?.message ?? FALLBACK_ERROR);
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label htmlFor="password" className="block text-sm font-medium text-gray-700">
        관리자 비밀번호
      </label>
      <Input
        id="password"
        type="password"
        autoComplete="current-password"
        autoFocus
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={submitting}
      />
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={submitting || password.length === 0}>
        {submitting ? '확인 중…' : '로그인'}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="mb-6 flex items-center gap-2 text-lg font-bold text-orange-600">
          <span className="text-2xl" aria-hidden="true">
            🍊
          </span>
          myTangerine 관리자
        </h1>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
