/**
 * @mytangerine/core 연동 플러그인
 */

import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import {
  Config,
  SheetService,
  DatabaseService,
  HybridDataService,
  LabelFormatter,
  type DataSourceMode,
} from '@mytangerine/core';

/**
 * Core 서비스 인터페이스
 */
export interface CoreServices {
  config: Config;
  sheetService: SheetService;
  databaseService: DatabaseService;
  /** 하이브리드 데이터 서비스 (Phase 2.3) - API routes에서 이 서비스를 사용 */
  dataService: HybridDataService;
  labelFormatter: LabelFormatter;
  /** 현재 데이터 소스 모드 */
  dataSourceMode: DataSourceMode;
}

/**
 * Fastify 인스턴스에 core 서비스 추가
 */
declare module 'fastify' {
  interface FastifyInstance {
    core: CoreServices;
  }
}

/**
 * Core 플러그인 옵션
 */
export interface CorePluginOptions {
  dataSource?: DataSourceMode;
}

/**
 * Core 플러그인
 * @mytangerine/core의 서비스들을 Fastify에 등록
 */
const corePlugin: FastifyPluginAsync<CorePluginOptions> = async (fastify, options) => {
  // 데이터 소스 모드 결정 (옵션 > 환경변수 > 기본값)
  const dataSourceMode: DataSourceMode =
    options.dataSource ||
    (process.env.DATA_SOURCE as DataSourceMode) ||
    'sheets';

  // Config 인스턴스 생성
  const config = new Config();

  // SheetService 인스턴스 생성
  const sheetService = new SheetService(config);

  // DatabaseService 인스턴스 생성 (Prisma 주입)
  const databaseService = new DatabaseService(config, fastify.prisma);

  // HybridDataService 인스턴스 생성 (Phase 2.3)
  const dataService = new HybridDataService(sheetService, databaseService, {
    mode: dataSourceMode,
    fallbackToSheets: true,
    logger: {
      info: (msg, ...args) => fastify.log.info(msg, ...args),
      warn: (msg, ...args) => fastify.log.warn(msg, ...args),
      error: (msg, ...args) => fastify.log.error(msg, ...args),
    },
  });

  // LabelFormatter 인스턴스 생성
  const labelFormatter = new LabelFormatter(config);

  // Fastify에 core 서비스 데코레이터로 등록
  fastify.decorate('core', {
    config,
    sheetService,
    databaseService,
    dataService,
    labelFormatter,
    dataSourceMode,
  });

  fastify.log.info(
    { dataSourceMode },
    `Core services initialized (mode: ${dataSourceMode})`
  );
};

export default fp(corePlugin, {
  name: 'core',
  dependencies: ['prisma'], // prisma 플러그인이 먼저 로드되어야 함
});
