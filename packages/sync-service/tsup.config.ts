import { defineConfig } from 'tsup';

/**
 * DTS 빌드 비활성화
 *
 * @mytangerine/core 패키지가 DTS를 생성하지 않아
 * sync-service의 DTS 빌드가 실패합니다.
 * 이 패키지는 실행 전용이므로 DTS가 필수적이지 않습니다.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  sourcemap: true,
});
