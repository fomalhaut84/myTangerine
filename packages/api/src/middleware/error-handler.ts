/**
 * 전역 에러 핸들링 미들웨어
 */

import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

/**
 * 에러 응답 포맷
 */
export interface ErrorResponse {
  success: false;
  error: string;
  statusCode: number;
  timestamp: string;
}

/**
 * 전역 에러 핸들러
 *
 * 모든 에러를 가로채서 일관된 형식으로 응답하고,
 * 내부 에러 상세는 로그에만 기록합니다.
 */
export async function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const statusCode = error.statusCode || 500;

  // 에러 상세 로깅 (서버 로그에만 기록)
  // PII 유출 방지를 위해 params/query는 로깅하지 않음
  request.log.error(
    {
      err: error,
      req: {
        method: request.method,
        url: request.url,
      },
    },
    'Request error'
  );

  // 클라이언트용 에러 메시지 (보안을 위해 일반화)
  let clientMessage: string;

  if (statusCode >= 500) {
    // 5xx 에러: 내부 에러 상세는 숨김
    clientMessage = '서버 내부 오류가 발생했습니다.';
  } else if (statusCode === 404) {
    clientMessage = '요청한 리소스를 찾을 수 없습니다.';
  } else if (statusCode === 400) {
    // 4xx 에러: 클라이언트 측 에러는 메시지 노출 가능
    clientMessage = error.message || '잘못된 요청입니다.';
  } else {
    clientMessage = error.message || '요청 처리에 실패했습니다.';
  }

  const response: ErrorResponse = {
    success: false,
    error: clientMessage,
    statusCode,
    timestamp: new Date().toISOString(),
  };

  reply.status(statusCode).send(response);
}
