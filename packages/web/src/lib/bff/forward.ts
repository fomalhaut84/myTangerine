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
/** PDF·Excel 생성 — 최대 1000건 선택 */
export const REPORT_TIMEOUT_MS = 2 * 60 * 1000;
/**
 * 동기화 — 5분. Node 전역 fetch(undici)의 headersTimeout·bodyTimeout 기본값(300초)이 실제 상한이라
 * 이보다 길게 잡아도 소용없다. 응답이 끊겨도 API 쪽 동기화는 분산 락(20분 TTL)을 쥔 채 끝까지 돈다.
 * 더 긴 동기화는 비동기 작업 + 상태 조회로 바꿔야 한다(후속 이슈).
 */
export const SYNC_TIMEOUT_MS = 5 * 60 * 1000;

export const DEFAULT_API_INTERNAL_URL = 'http://127.0.0.1:3001';

const FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'content-disposition',
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

function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function timeoutFor(upstreamPath: string): number {
  if (under(upstreamPath, '/api/sync')) return SYNC_TIMEOUT_MS;
  if (under(upstreamPath, '/api/orders/report')) return REPORT_TIMEOUT_MS;
  return DEFAULT_TIMEOUT_MS;
}

const UNSAFE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * 상태를 바꾸는 요청의 출처 검사 (심층 방어 · 세션 쿠키 SameSite=Lax 에 더해).
 * - 브라우저가 보낸 Sec-Fetch-Site 가 same-origin 이 아니면 거부(같은 사이트의 다른 서브도메인 포함)
 * - 본문이 있으면 application/json 만 — 교차 사이트 폼(text/plain · form-urlencoded)으로는 만들 수 없는 형식
 */
export function rejectUnsafeRequest(method: string, headers: Headers, hasBody: boolean): string | null {
  if (!UNSAFE_METHODS.has(method)) return null;
  const site = headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin') return 'cross-site';
  if (hasBody) {
    const type = (headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') return 'content-type';
  }
  return null;
}

/** fetch 실패가 타임아웃인가 — AbortSignal.timeout 과 undici 자체 타임아웃(headers/body) 모두 */
export function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return true;
  const code = (error.cause as { code?: unknown } | undefined)?.code;
  return code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT';
}

export function apiInternalUrl(): string {
  return (process.env.API_INTERNAL_URL || DEFAULT_API_INTERNAL_URL).replace(/\/+$/, '');
}
