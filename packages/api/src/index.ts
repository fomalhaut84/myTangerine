/**
 * @mytangerine/api
 * Fastify REST API 서버
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { loadEnv, loadPackageMetadata, type Env } from './config.js';
import corePlugin from './plugins/core.js';
import ordersRoutes from './routes/orders.js';
import labelsRoutes from './routes/labels.js';
import { errorHandler } from './middleware/error-handler.js';

/**
 * Fastify 서버 생성 및 설정
 */
export async function createServer(env: Env): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport:
        env.NODE_ENV === 'development'
          ? {
              target: 'pino-pretty',
              options: {
                translateTime: 'HH:MM:ss Z',
                ignore: 'pid,hostname',
              },
            }
          : undefined,
    },
  });

  // CORS 설정 (환경 변수에서 읽기)
  await server.register(cors, {
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN,
  });

  // Core 플러그인 등록 (@mytangerine/core 연동)
  await server.register(corePlugin);

  // 전역 에러 핸들러 등록
  server.setErrorHandler(errorHandler);

  // Package metadata 로드
  const packageMetadata = await loadPackageMetadata();

  // 헬스체크 엔드포인트
  server.get('/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: packageMetadata.version,
    };
  });

  // 루트 엔드포인트
  server.get('/', async () => {
    return packageMetadata;
  });

  // API 라우트 등록
  await server.register(ordersRoutes);
  await server.register(labelsRoutes);

  return server;
}

/**
 * 서버 시작
 */
async function start() {
  let server: FastifyInstance | null = null;

  try {
    const env = loadEnv();
    server = await createServer(env);

    await server.listen({ port: env.PORT, host: env.HOST });
    server.log.info(`Server listening on http://${env.HOST}:${env.PORT}`);

    // Graceful shutdown 설정
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
    signals.forEach((signal) => {
      process.on(signal, async () => {
        if (server) {
          server.log.info(`Received ${signal}, closing server gracefully...`);
          try {
            await server.close();
            server.log.info('Server closed successfully');
            process.exit(0);
          } catch (err) {
            server.log.error(err, 'Error during graceful shutdown');
            process.exit(1);
          }
        }
      });
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    if (server) {
      await server.close();
    }
    process.exit(1);
  }
}

// 직접 실행될 때만 서버 시작 (테스트 시에는 시작하지 않음)
if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}
