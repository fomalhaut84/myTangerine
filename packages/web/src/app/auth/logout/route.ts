/**
 * 관리자 로그아웃 (#219) — 세션 쿠키를 지운다.
 *
 * 토큰은 서버에 저장하지 않으므로 이미 복사된 토큰까지 무효로 하려면 SESSION_SECRET 을 바꾼다.
 */

import { NextResponse } from 'next/server';
import { clearedSessionCookie } from '@/lib/auth/cookie';

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(clearedSessionCookie());
  return response;
}
