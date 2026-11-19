/**
 * 데이터 소스 모드 결정 (#245)
 *
 * prisma 플러그인과 core 플러그인이 같은 규칙으로 모드를 정하도록 한 곳에 둔다.
 * 우선순위: 플러그인 옵션 > DATA_SOURCE 환경변수 > 기본값 sheets
 *
 * 타입은 core `DataSourceMode` 와 같은 리터럴 합이다 — core 를 import 하지 않아
 * 타입 선언(dist d.ts) 유무에 흔들리지 않게 했다.
 */

export type DataSourceModeName = 'sheets' | 'database' | 'hybrid';

export const DEFAULT_DATA_SOURCE_MODE: DataSourceModeName = 'sheets';

export function resolveDataSourceMode(option?: DataSourceModeName): DataSourceModeName {
  return option || (process.env.DATA_SOURCE as DataSourceModeName | undefined) || DEFAULT_DATA_SOURCE_MODE;
}
