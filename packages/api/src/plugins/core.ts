/**
 * @mytangerine/core 연동 플러그인
 */

import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { Config, SheetService, LabelFormatter } from '@mytangerine/core';

/**
 * Core 서비스 인터페이스
 */
export interface CoreServices {
  config: Config;
  sheetService: SheetService;
  labelFormatter: LabelFormatter;
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
 * Core 플러그인
 * @mytangerine/core의 서비스들을 Fastify에 등록
 */
const corePlugin: FastifyPluginAsync = async (fastify) => {
  // Config 인스턴스 생성
  const config = new Config();

  // SheetService 인스턴스 생성
  const sheetService = new SheetService(config);

  // LabelFormatter 인스턴스 생성
  const labelFormatter = new LabelFormatter(config);

  // Fastify에 core 서비스 데코레이터로 등록
  fastify.decorate('core', {
    config,
    sheetService,
    labelFormatter,
  });

  fastify.log.info('Core services initialized');
};

export default fp(corePlugin, {
  name: 'core',
});
