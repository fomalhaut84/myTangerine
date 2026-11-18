/**
 * API 키 검증 (#218)
 *
 * 두 값을 sha256 다이제스트로 바꿔 길이를 같게 맞춘 뒤 timingSafeEqual 로 비교한다 —
 * 일반 문자열 비교는 일치하는 앞부분 길이에 따라 응답 시간이 달라진다.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

export const API_KEY_HEADER = 'x-api-key';

export type ApiKeyCheck = 'ok' | 'missing' | 'invalid' | 'unconfigured';

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * 헤더 값이 반복되면(배열 길이 2 이상) 어느 하나를 고르지 않고 거부한다.
 */
function normalizeHeader(provided: string | string[] | undefined): string | null | 'ambiguous' {
  if (Array.isArray(provided)) {
    if (provided.length === 0) return null;
    if (provided.length > 1) return 'ambiguous';
    return provided[0] || null;
  }
  return provided || null;
}

export function verifyApiKey(
  provided: string | string[] | undefined,
  expected: string | undefined
): ApiKeyCheck {
  if (!expected) return 'unconfigured';

  const value = normalizeHeader(provided);
  if (value === null) return 'missing';
  if (value === 'ambiguous') return 'invalid';

  return timingSafeEqual(digest(value), digest(expected)) ? 'ok' : 'invalid';
}

const RESPONSES: Record<Exclude<ApiKeyCheck, 'ok'>, { statusCode: number; error: string; message: string }> = {
  unconfigured: {
    statusCode: 503,
    error: 'Service Unavailable',
    message: 'API authentication is not configured',
  },
  missing: { statusCode: 401, error: 'Unauthorized', message: 'API key is required' },
  invalid: { statusCode: 403, error: 'Forbidden', message: 'Invalid API key' },
};

/**
 * 실패 결과의 응답 본문 — 받은 키·기대 키는 담지 않는다.
 */
export function apiKeyFailure(result: Exclude<ApiKeyCheck, 'ok'>) {
  const { statusCode, error, message } = RESPONSES[result];
  return {
    statusCode,
    body: {
      success: false as const,
      error,
      message,
      statusCode,
      timestamp: new Date().toISOString(),
    },
  };
}
