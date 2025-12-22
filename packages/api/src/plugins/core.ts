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
  /** SheetService (database 모드에서는 null) */
  sheetService: SheetService | null;
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

  // SheetService 인스턴스 생성 (database 모드에서는 생성하지 않음)
  // P1 수정: database 모드에서 Google 자격 증명 없이도 서버가 시작되도록 함
  let sheetService: SheetService | null = null;
  if (dataSourceMode !== 'database') {
    sheetService = new SheetService(config);
  }

  // DatabaseService 인스턴스 생성 (Prisma 주입)
  // sheets 모드에서도 DatabaseService는 생성 (sync 등에서 사용 가능)
  const databaseService = new DatabaseService(config, fastify.prisma);

  // HybridDataService 인스턴스 생성 (Phase 2.3)
  const dataService = new HybridDataService(sheetService, databaseService, {
    mode: dataSourceMode,
    fallbackToSheets: dataSourceMode !== 'database', // database 모드에서는 폴백 비활성화
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
