/**
 * 요청 검증 미들웨어 테스트
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';

describe('Validate Middleware', () => {
  let server: FastifyInstance;

  const querySchema = z.object({
    limit: z
      .string()
      .transform((val) => parseInt(val, 10))
      .refine((val) => !isNaN(val), { message: 'limit must be a valid number' })
      .optional(),
    offset: z
      .string()
      .transform((val) => parseInt(val, 10))
      .refine((val) => !isNaN(val), { message: 'offset must be a valid number' })
      .optional(),
  });

  const bodySchema = z.object({
    name: z.string().min(1),
    age: z.number().int().positive(),
  });

  beforeAll(async () => {
    server = Fastify({ logger: false });

    // Query 검증 테스트 라우트
    server.get(
      '/test/query',
      { preHandler: validate(querySchema, 'query') },
      async (request) => {
        return { query: request.query };
      }
    );

    // Body 검증 테스트 라우트
    server.post(
      '/test/body',
      { preHandler: validate(bodySchema, 'body') },
      async (request) => {
        return { body: request.body };
      }
    );

    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  describe('Query Validation', () => {
    it('should pass validation with valid query params', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/test/query?limit=10&offset=20',
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.query.limit).toBe(10);
      expect(payload.query.offset).toBe(20);
    });

    it('should pass validation with optional params missing', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/test/query',
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.query).toBeDefined();
    });

    it('should fail validation with invalid query params', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/test/query?limit=invalid',
      });

      expect(response.statusCode).toBe(400);
      const payload = JSON.parse(response.payload);
      expect(payload.success).toBe(false);
      expect(payload.error).toBe('요청 데이터가 유효하지 않습니다.');
      expect(payload).toHaveProperty('details');
      expect(Array.isArray(payload.details)).toBe(true);
    });
  });

  describe('Body Validation', () => {
    it('should pass validation with valid body', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/test/body',
        payload: {
          name: 'John Doe',
          age: 30,
        },
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.body.name).toBe('John Doe');
      expect(payload.body.age).toBe(30);
    });

    it('should fail validation with missing required field', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/test/body',
        payload: {
          age: 30,
        },
      });

      expect(response.statusCode).toBe(400);
      const payload = JSON.parse(response.payload);
      expect(payload.success).toBe(false);
      expect(payload.details).toBeDefined();
    });

    it('should fail validation with invalid field type', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/test/body',
        payload: {
          name: 'John Doe',
          age: 'invalid',
        },
      });

      expect(response.statusCode).toBe(400);
      const payload = JSON.parse(response.payload);
      expect(payload.success).toBe(false);
    });

    it('should fail validation with invalid field value', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/test/body',
        payload: {
          name: '', // min(1) 위반
          age: 30,
        },
      });

      expect(response.statusCode).toBe(400);
      const payload = JSON.parse(response.payload);
      expect(payload.success).toBe(false);
    });
  });

  describe('Error Response Format', () => {
    it('should return validation errors with correct structure', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/test/body',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const payload = JSON.parse(response.payload);

      expect(payload).toHaveProperty('success', false);
      expect(payload).toHaveProperty('error');
      expect(payload).toHaveProperty('statusCode', 400);
      expect(payload).toHaveProperty('timestamp');
      expect(payload).toHaveProperty('details');

      expect(Array.isArray(payload.details)).toBe(true);
      if (payload.details.length > 0) {
        expect(payload.details[0]).toHaveProperty('path');
        expect(payload.details[0]).toHaveProperty('message');
      }
    });
  });
});
