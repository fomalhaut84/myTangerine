/**
 * @mytangerine/api
 * Fastify REST API 서버
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
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
    ajv: {
      customOptions: {
        // JSON Schema의 example 키워드 허용 (OpenAPI spec용)
        // strict: false는 모든 strict checks를 비활성화
        strict: false,
      },
    },
  });

  // CORS 설정 (환경 변수에서 읽기)
  await server.register(cors, {
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN,
  });

  // Package metadata 로드 (Swagger 설정에 필요)
  const packageMetadata = await loadPackageMetadata();

  // Swagger 문서화 설정
  await server.register(swagger, {
    openapi: {
      info: {
        title: packageMetadata.name,
        description: packageMetadata.description,
        version: packageMetadata.version,
      },
      servers: [
        {
          url: `http://${env.HOST}:${env.PORT}`,
          description: 'Development server',
        },
      ],
      tags: [
        { name: 'orders', description: '주문 관리 API' },
        { name: 'labels', description: '배송 라벨 생성 API' },
      ],
      components: {
        schemas: {
          PersonInfo: {
            type: 'object',
            required: ['name', 'phone', 'address'],
            properties: {
              name: { type: 'string', description: '이름', example: '홍길동' },
              phone: { type: 'string', description: '전화번호', example: '010-1234-5678' },
              address: { type: 'string', description: '주소', example: '서울시 강남구' },
            },
          },
          Order: {
            type: 'object',
            required: [
              'timestamp',
              'timestampRaw',
              'status',
              'sender',
              'recipient',
              'productType',
              'quantity',
              'rowNumber',
            ],
            properties: {
              timestamp: {
                type: 'string',
                format: 'date-time',
                description: '주문 시각 (ISO 8601)',
                example: '2025-01-21T10:30:00.000Z',
              },
              timestampRaw: {
                type: 'string',
                description: '원본 타임스탬프',
                example: '2025-01-21 오전 10:30:00',
              },
              status: {
                type: 'string',
                description: '주문 상태 (비고 컬럼 값)',
                example: '',
              },
              sender: { $ref: '#/components/schemas/PersonInfo' },
              recipient: { $ref: '#/components/schemas/PersonInfo' },
              productType: {
                type: ['string', 'null'],
                enum: ['5kg', '10kg', null],
                description: '상품 종류 (검증 실패 시 null)',
                example: '5kg',
              },
              quantity: {
                type: 'integer',
                minimum: 1,
                description: '주문 수량',
                example: 2,
              },
              rowNumber: {
                type: 'integer',
                minimum: 1,
                description: '스프레드시트 행 번호',
                example: 15,
              },
              validationError: {
                type: 'string',
                description: '검증 에러 메시지 (상품 선택 검증 실패 시)',
                example: '유효하지 않은 상품 타입: "3kg"',
              },
            },
          },
          ProductSummary: {
            type: 'object',
            required: ['count', 'amount'],
            properties: {
              count: {
                type: 'integer',
                minimum: 0,
                description: '수량',
                example: 10,
              },
              amount: {
                type: 'integer',
                minimum: 0,
                description: '금액 (KRW)',
                example: 350000,
              },
            },
          },
          OrderSummary: {
            type: 'object',
            required: ['5kg', '10kg', 'total'],
            properties: {
              '5kg': { $ref: '#/components/schemas/ProductSummary' },
              '10kg': { $ref: '#/components/schemas/ProductSummary' },
              total: {
                type: 'integer',
                minimum: 0,
                description: '총 금액 (KRW)',
                example: 650000,
              },
            },
          },
          ErrorResponse: {
            type: 'object',
            required: ['success', 'error', 'statusCode', 'timestamp'],
            properties: {
              success: { type: 'boolean', enum: [false], example: false },
              error: { type: 'string', description: '에러 메시지', example: '서버 내부 오류가 발생했습니다.' },
              statusCode: { type: 'integer', description: 'HTTP 상태 코드', example: 500 },
              timestamp: {
                type: 'string',
                format: 'date-time',
                description: '에러 발생 시각',
                example: '2025-01-21T10:30:00.000Z',
              },
            },
          },
        },
      },
    },
  });

  // Swagger UI 등록
  await server.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
    staticCSP: true,
  });

  // Fastify의 addSchema로 스키마 등록 (serialization을 위해 필요)
  server.addSchema({
    $id: 'PersonInfo',
    type: 'object',
    required: ['name', 'phone', 'address'],
    properties: {
      name: { type: 'string', description: '이름', example: '홍길동' },
      phone: { type: 'string', description: '전화번호', example: '010-1234-5678' },
      address: { type: 'string', description: '주소', example: '서울시 강남구' },
    },
  });

  server.addSchema({
    $id: 'Order',
    type: 'object',
    required: [
      'timestamp',
      'timestampRaw',
      'status',
      'sender',
      'recipient',
      'productType',
      'quantity',
      'rowNumber',
    ],
    properties: {
      timestamp: {
        type: 'string',
        format: 'date-time',
        description: '주문 시각 (ISO 8601)',
        example: '2025-01-21T10:30:00.000Z',
      },
      timestampRaw: {
        type: 'string',
        description: '원본 타임스탬프',
        example: '2025-01-21 오전 10:30:00',
      },
      status: {
        type: 'string',
        description: '주문 상태 (비고 컬럼 값)',
        example: '',
      },
      sender: { $ref: 'PersonInfo#' },
      recipient: { $ref: 'PersonInfo#' },
      productType: {
        type: ['string', 'null'],
        enum: ['5kg', '10kg', null],
        description: '상품 종류 (검증 실패 시 null)',
        example: '5kg',
      },
      quantity: {
        type: 'integer',
        minimum: 1,
        description: '주문 수량',
        example: 2,
      },
      rowNumber: {
        type: 'integer',
        minimum: 1,
        description: '스프레드시트 행 번호',
        example: 15,
      },
      validationError: {
        type: 'string',
        description: '검증 에러 메시지 (상품 선택 검증 실패 시)',
        example: '유효하지 않은 상품 타입: "3kg"',
      },
    },
  });

  server.addSchema({
    $id: 'ProductSummary',
    type: 'object',
    required: ['count', 'amount'],
    properties: {
      count: {
        type: 'integer',
        minimum: 0,
        description: '수량',
        example: 10,
      },
      amount: {
        type: 'integer',
        minimum: 0,
        description: '금액 (KRW)',
        example: 350000,
      },
    },
  });

  server.addSchema({
    $id: 'OrderSummary',
    type: 'object',
    required: ['5kg', '10kg', 'total'],
    properties: {
      '5kg': { $ref: 'ProductSummary#' },
      '10kg': { $ref: 'ProductSummary#' },
      total: {
        type: 'integer',
        minimum: 0,
        description: '총 금액 (KRW)',
        example: 650000,
      },
    },
  });

  server.addSchema({
    $id: 'ErrorResponse',
    type: 'object',
    required: ['success', 'error', 'statusCode', 'timestamp'],
    properties: {
      success: { type: 'boolean', enum: [false], example: false },
      error: { type: 'string', description: '에러 메시지', example: '서버 내부 오류가 발생했습니다.' },
      statusCode: { type: 'integer', description: 'HTTP 상태 코드', example: 500 },
      timestamp: {
        type: 'string',
        format: 'date-time',
        description: '에러 발생 시각',
        example: '2025-01-21T10:30:00.000Z',
      },
    },
  });

  // Core 플러그인 등록 (@mytangerine/core 연동)
  await server.register(corePlugin);

  // 전역 에러 핸들러 등록
  server.setErrorHandler(errorHandler);

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
