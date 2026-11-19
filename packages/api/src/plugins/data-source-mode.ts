/**
 * 데이터 소스 모드 결정 (#245)
 *
 * prisma 플러그인과 core 플러그인이 같은 규칙으로 모드를 정하도록 한 곳에 둔다.
 * 우선순위: 플러그인 옵션 > DATA_SOURCE 환경변수 > 기본값 sheets
 */

import type { DataSourceMode } from '@mytangerine/core';

export const DEFAULT_DATA_SOURCE_MODE: DataSourceMode = 'sheets';

export function resolveDataSourceMode(option?: DataSourceMode): DataSourceMode {
  return option || (process.env.DATA_SOURCE as DataSourceMode | undefined) || DEFAULT_DATA_SOURCE_MODE;
}
