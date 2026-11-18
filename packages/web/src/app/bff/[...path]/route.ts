/**
 * 웹 서버 경유 API 호출 (#220) — `/bff/api/{orders|labels|sync}/...` → 내부 API.
 *
 * proxy.ts 가 세션을 이미 확인하지만, 서버 키를 붙이는 곳이므로 여기서 한 번 더 확인한다.
 * /api 가 아닌 /bff 아래에 둔다 — 운영 리버스 프록시가 /api 를 API 서버로 보낼 수 있다.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, sessionKey, verifySessionToken } from '@/lib/auth/session';
import {
  MAX_BODY_BYTES,
  apiInternalUrl,
  isTimeoutError,
  pickResponseHeaders,
  rejectUnsafeRequest,
  resolveUpstreamPath,
  timeoutFor,
} from '@/lib/bff/forward';

export const dynamic = 'force-dynamic';

function fail(status: number, message: string) {
  return NextResponse.json(
    { success: false, message },
    { status, headers: { 'Cache-Control': 'no-store' } }
  );
}

async function readBody(request: NextRequest): Promise<ArrayBuffer | null | 'too-large'> {
  if (request.method === 'GET' || request.method === 'HEAD') return null;
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return 'too-large';
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) return 'too-large';
  return body.byteLength === 0 ? null : body;
}

function upstreamHeaders(request: NextRequest, apiKey: string): Headers {
  const headers = new Headers({ 'x-api-key': apiKey, 'x-app-client': 'web' });
  for (const name of ['content-type', 'accept']) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

async function forward(request: NextRequest): Promise<Response> {
  if (!verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value, sessionKey())) {
    return fail(401, '로그인이 필요합니다.');
  }

  const upstreamPath = resolveUpstreamPath(request.nextUrl.pathname);
  if (upstreamPath === null) return fail(404, '요청한 리소스를 찾을 수 없습니다.');

  const apiKey = process.env.API_SECRET_KEY;
  if (!apiKey) {
    console.error('[bff] API_SECRET_KEY 가 설정되지 않았습니다');
    return fail(503, '서버 설정 오류가 발생했습니다.');
  }

  const body = await readBody(request);
  if (body === 'too-large') return fail(413, '요청이 너무 큽니다.');

  const unsafe = rejectUnsafeRequest(request.method, request.headers, body !== null);
  if (unsafe === 'cross-site') return fail(403, '허용되지 않은 요청입니다.');
  if (unsafe === 'content-type') return fail(415, 'JSON 요청만 받습니다.');

  const target = `${apiInternalUrl()}${upstreamPath}${request.nextUrl.search}`;
  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers: upstreamHeaders(request, apiKey),
      body,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutFor(upstreamPath)),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: pickResponseHeaders(upstream.headers),
    });
  } catch (error) {
    const timedOut = isTimeoutError(error);
    console.error('[bff] API 호출 실패', { method: request.method, path: upstreamPath, timedOut, error });
    return timedOut
      ? fail(504, '요청 처리 시간이 초과되었습니다. 동기화라면 서버에서 계속 진행 중일 수 있습니다.')
      : fail(502, 'API 서버에 연결할 수 없습니다.');
  }
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const PUT = forward;
export const DELETE = forward;
