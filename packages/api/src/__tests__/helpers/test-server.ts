/**
 * 테스트용 Fastify 서버 생성 헬퍼
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { Config, LabelFormatter } from '@mytangerine/core';
import { MockSheetService } from './mock-sheet-service.js';
import ordersRoutes from '../../routes/orders.js';
import labelsRoutes from '../../routes/labels.js';
import { errorHandler } from '../../middleware/error-handler.js';

/**
 * 테스트용 Fastify 서버 생성
 * - 실제 SheetService 대신 MockSheetService 사용
 * - Google Sheets API 호출 없이 테스트 가능
 */
export async function createTestServer(): Promise<{
  server: FastifyInstance;
  mockSheetService: MockSheetService;
}> {
  // 테스트용 환경 변수 설정
  process.env.DEFAULT_SENDER_NAME = 'Test Sender';
  process.env.DEFAULT_SENDER_PHONE = '010-1234-5678';
  process.env.DEFAULT_SENDER_ADDRESS = 'Test Address';
  process.env.SPREADSHEET_ID = 'test-sheet-id';
  process.env.GOOGLE_CREDENTIALS_JSON = JSON.stringify({
    type: 'service_account',
    project_id: 'test-project',
    private_key_id: 'test-key-id',
    private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n',
    client_email: 'test@test.iam.gserviceaccount.com',
    client_id: 'test',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
  });

  const server = Fastify({
    logger: false,
    ajv: {
      customOptions: {
        // JSON Schema의 example 키워드 허용 (OpenAPI spec용)
        strict: false,
      },
    },
  });

  // CORS
  await server.register(cors, { origin: true });

  // Swagger (스키마 참조를 위해 필요)
  await server.register(swagger, {
    openapi: {
      info: {
        title: 'Test API',
        version: '1.0.0',
      },
      components: {
        schemas: {
          PersonInfo: {
            type: 'object',
            required: ['name', 'phone', 'address'],
            properties: {
              name: { type: 'string' },
              phone: { type: 'string' },
              address: { type: 'string' },
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
              timestamp: { type: 'string', format: 'date-time' },
              timestampRaw: { type: 'string' },
              status: { type: 'string' },
              sender: { $ref: '#/components/schemas/PersonInfo' },
              recipient: { $ref: '#/components/schemas/PersonInfo' },
              productType: { type: ['string', 'null'], enum: ['비상품', '5kg', '10kg', null] },
              quantity: { type: 'integer', minimum: 1 },
              rowNumber: { type: 'integer', minimum: 1 },
              validationError: { type: 'string' },
            },
          },
          ProductSummary: {
            type: 'object',
            required: ['count', 'amount'],
            properties: {
              count: { type: 'integer', minimum: 0 },
              amount: { type: 'integer', minimum: 0 },
            },
          },
          OrderSummary: {
            type: 'object',
            required: ['5kg', '10kg', 'total'],
            properties: {
              '5kg': { $ref: '#/components/schemas/ProductSummary' },
              '10kg': { $ref: '#/components/schemas/ProductSummary' },
              total: { type: 'integer', minimum: 0 },
            },
          },
          ErrorResponse: {
            type: 'object',
            required: ['success', 'error', 'statusCode', 'timestamp'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { type: 'string' },
              statusCode: { type: 'integer' },
              timestamp: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  });

  // Swagger UI (테스트에서는 불필요하지만 스키마 초기화를 위해 등록)
  await server.register(swaggerUi, {
    routePrefix: '/docs',
  });

  // Fastify의 addSchema로 스키마 등록 (serialization을 위해 필요)
  server.addSchema({
    $id: 'PersonInfo',
    type: 'object',
    required: ['name', 'phone', 'address'],
    properties: {
      name: { type: 'string' },
      phone: { type: 'string' },
      address: { type: 'string' },
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
      timestamp: { type: 'string', format: 'date-time' },
      timestampRaw: { type: 'string' },
      status: { type: 'string' },
      sender: { $ref: 'PersonInfo#' },
      recipient: { $ref: 'PersonInfo#' },
      productType: { type: ['string', 'null'], enum: ['비상품', '5kg', '10kg', null] },
      quantity: { type: 'integer', minimum: 1 },
      rowNumber: { type: 'integer', minimum: 1 },
      validationError: { type: 'string' },
      orderType: { type: 'string', enum: ['customer', 'gift'] },
      isDeleted: { type: 'boolean' },
      deletedAt: { type: 'string', format: 'date-time' },
      trackingNumber: { type: 'string' },
      ordererName: { type: 'string' },
      ordererEmail: { type: 'string' },
    },
  });

  server.addSchema({
    $id: 'ProductSummary',
    type: 'object',
    required: ['count', 'amount'],
    properties: {
      count: { type: 'integer', minimum: 0 },
      amount: { type: 'integer', minimum: 0 },
    },
  });

  server.addSchema({
    $id: 'OrderSummary',
    type: 'object',
    required: ['5kg', '10kg', 'total'],
    properties: {
      '5kg': { $ref: 'ProductSummary#' },
      '10kg': { $ref: 'ProductSummary#' },
      total: { type: 'integer', minimum: 0 },
    },
  });

  server.addSchema({
    $id: 'ErrorResponse',
    type: 'object',
    required: ['success', 'error', 'statusCode', 'timestamp'],
    properties: {
      success: { type: 'boolean', enum: [false] },
      error: { type: 'string' },
      statusCode: { type: 'integer' },
      timestamp: { type: 'string', format: 'date-time' },
    },
  });

  // Mock services 생성
  const config = new Config();
  const mockSheetService = new MockSheetService();
  const labelFormatter = new LabelFormatter(config);

  // Core services decorator (mock 포함)
  // dataService는 HybridDataService와 동일한 인터페이스를 구현한 mockSheetService 사용
  server.decorate('core', {
    config,
    sheetService: mockSheetService,
    dataService: mockSheetService, // HybridDataService 대신 mock 사용
    labelFormatter,
  });

  // 전역 에러 핸들러
  server.setErrorHandler(errorHandler);

  // 라우트 등록
  await server.register(ordersRoutes);
  await server.register(labelsRoutes);

  await server.ready();

  return { server, mockSheetService };
}
