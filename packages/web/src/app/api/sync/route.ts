/**
 * Next.js API Route - Sync Proxy
 * 서버 사이드에서만 API 키를 사용하여 보안 강화
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';
    const apiSecretKey = process.env.API_SECRET_KEY;

    if (!apiSecretKey) {
      console.error('[Sync Proxy] API_SECRET_KEY not configured');
      return NextResponse.json(
        {
          success: false,
          error: 'Server configuration error',
          message: '서버 설정 오류가 발생했습니다.',
        },
        { status: 503 }
      );
    }

    // API 서버로 프록시
    const response = await fetch(`${apiBaseUrl}/api/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiSecretKey,
        'x-app-client': 'web',
      },
      body: JSON.stringify({}),
      // 20분 타임아웃 (분산 락 TTL과 동일)
      signal: AbortSignal.timeout(20 * 60 * 1000),
    });

    const data = await response.json();

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[Sync Proxy] Error:', error);

    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(
        {
          success: false,
          error: 'Timeout',
          message: '동기화 작업이 시간 초과되었습니다.',
        },
        { status: 504 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Proxy error',
        message: '동기화 요청 처리 중 오류가 발생했습니다.',
      },
      { status: 500 }
    );
  }
}
