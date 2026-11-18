/**
 * 웹 서버 경유 API 호출 규칙 (#220) — 경로 허용 목록 · 응답 헤더 · 타임아웃.
 *
 * 브라우저는 같은 오리진 `/bff/api/...` 만 부르고, 웹 서버가 세션을 확인한 뒤 서버 키를 붙여
 * 내부 API 로 전달한다. API 키는 브라우저에 가지 않는다.
 */

export const BFF_PREFIX = '/bff';

/** 브라우저에서 부를 수 있는 API 영역 — 그 밖(헬스체크 · 문서 등)은 전달하지 않는다 */
const ALLOWED_AREAS: ReadonlySet<string> = new Set(['orders', 'labels', 'sync']);

/** 요청 본문 상한 — API(Fastify) 기본 bodyLimit 과 같다 */
export const MAX_BODY_BYTES = 1024 * 1024;

export const DEFAULT_TIMEOUT_MS = 30 * 1000;
/** 동기화는 분산 락 TTL 과 같은 20분 */
export const SYNC_TIMEOUT_MS = 20 * 60 * 1000;

export const DEFAULT_API_INTERNAL_URL = 'http://127.0.0.1:3001';

const FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'content-disposition',
  'content-length',
  'x-order-count',
  'x-generated-at',
  'retry-after',
] as const;

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * `/bff/api/<area>/...` → `/api/<area>/...` (세그먼트마다 다시 인코딩). 허용되지 않으면 null.
 * 점 세그먼트 · 빈 세그먼트 · 디코딩 뒤 `/`·`\` 가 생기는 세그먼트는 거부한다(경로 조작 방지).
 */
export function resolveUpstreamPath(pathname: string): string | null {
  if (!pathname.startsWith(`${BFF_PREFIX}/`)) return null;

  const rawSegments = pathname.slice(BFF_PREFIX.length + 1).split('/');
  const segments: string[] = [];
  for (const raw of rawSegments) {
    const decoded = decodeSegment(raw);
    if (decoded === null || decoded === '' || decoded === '.' || decoded === '..') return null;
    if (decoded.includes('/') || decoded.includes('\\')) return null;
    segments.push(decoded);
  }

  if (segments.length < 2 || segments[0] !== 'api' || !ALLOWED_AREAS.has(segments[1])) return null;
  return `/${segments.map(encodeURIComponent).join('/')}`;
}

export function pickResponseHeaders(upstream: Headers): Headers {
  const picked = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.get(name);
    if (value !== null) picked.set(name, value);
  }
  // 주문(개인정보) 응답은 브라우저·중간 캐시에 남기지 않는다
  picked.set('cache-control', 'no-store');
  return picked;
}

export function timeoutFor(upstreamPath: string): number {
  return upstreamPath === '/api/sync' || upstreamPath.startsWith('/api/sync/')
    ? SYNC_TIMEOUT_MS
    : DEFAULT_TIMEOUT_MS;
}

export function apiInternalUrl(): string {
  return (process.env.API_INTERNAL_URL || DEFAULT_API_INTERNAL_URL).replace(/\/+$/, '');
}
