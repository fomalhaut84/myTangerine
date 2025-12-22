/**
 * Next.js API Route - Full Sync Proxy
 * 전체 재동기화 (POST /api/sync/full)
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const apiInternalUrl = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';
    const apiSecretKey = process.env.API_SECRET_KEY;

    if (!apiSecretKey) {
      console.error('[Full Sync Proxy] API_SECRET_KEY not configured');
      return NextResponse.json(
        {
          success: false,
          error: 'Server configuration error',
          message: '서버 설정 오류가 발생했습니다.',
        },
        { status: 503 }
      );
    }

    // API 서버로 프록시 (20분 타임아웃)
    const response = await fetch(`${apiInternalUrl}/api/sync/full`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiSecretKey,
        'x-app-client': 'web',
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(20 * 60 * 1000),
    });

    const data = await response.json();

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[Full Sync Proxy] Error:', error);

    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(
        {
          success: false,
          error: 'Timeout',
          message: '전체 동기화 작업이 시간 초과되었습니다.',
        },
        { status: 504 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Proxy error',
        message: '전체 동기화 요청 처리 중 오류가 발생했습니다.',
      },
      { status: 500 }
    );
  }
}
