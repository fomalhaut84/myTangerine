/**
 * Next.js API Route - Sync Status Proxy
 * 동기화 상태 조회 (GET /api/sync/status)
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const apiInternalUrl = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';
    const apiSecretKey = process.env.API_SECRET_KEY;

    if (!apiSecretKey) {
      console.error('[Sync Status Proxy] API_SECRET_KEY not configured');
      return NextResponse.json(
        {
          success: false,
          error: 'Server configuration error',
          message: '서버 설정 오류가 발생했습니다.',
        },
        { status: 503 }
      );
    }

    const response = await fetch(`${apiInternalUrl}/api/sync/status`, {
      method: 'GET',
      headers: {
        'x-api-key': apiSecretKey,
        'x-app-client': 'web',
      },
    });

    const data = await response.json();

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[Sync Status Proxy] Error:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Proxy error',
        message: '동기화 상태 조회 중 오류가 발생했습니다.',
      },
      { status: 500 }
    );
  }
}
