import { defineConfig } from 'tsup';

/**
 * TODO: DTS 빌드 재활성화
 * 현재 CI 환경에서 tsup의 DTS 빌드가 @prisma/client를 해석하지 못하는 문제로
 * dts: false로 설정함. 로컬에서는 `pnpm build:types`로 타입 정의 생성 가능.
 *
 * 참고: https://github.com/fomalhaut84/myTangerine/issues/XXX
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  treeshake: true,
  outDir: 'dist',
  external: ['@prisma/client'],
});
