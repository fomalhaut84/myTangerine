/**
 * hybrid 쓰기 부분 실패를 응답에 싣는다 (#197)
 *
 * 응답 스키마에 선언되지 않은 필드는 fast-json-stringify 가 잘라내므로, 쓰기 라우트의 200 스키마에
 * WARNINGS_SCHEMA 를 함께 선언한다. 경고가 없으면 필드를 넣지 않는다.
 */

export const WARNINGS_SCHEMA = {
  type: 'array',
  items: { type: 'string' },
  description: 'DB 에는 반영됐지만 구글 시트 반영에 실패한 경우 등 사용자에게 보여 줄 경고 (hybrid 모드)',
} as const;

interface MaybeOutcome {
  warnings?: string[];
}

export function warningsField(outcome: MaybeOutcome | void | undefined): { warnings?: string[] } {
  const warnings = outcome && Array.isArray(outcome.warnings) ? outcome.warnings : [];
  return warnings.length > 0 ? { warnings } : {};
}
