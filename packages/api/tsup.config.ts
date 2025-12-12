import { defineConfig } from 'tsup';

/**
 * TODO: DTS 빌드 재활성화
 * @mytangerine/core 패키지의 DTS 빌드 문제로 인해 일시적으로 비활성화
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  external: ['@prisma/client'],
});
