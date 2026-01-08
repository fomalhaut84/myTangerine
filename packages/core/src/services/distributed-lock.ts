/**
 * DB 기반 분산 락 서비스
 * 여러 프로세스/서버 간 동시 실행 방지
 */

import { PrismaClient } from '@prisma/client';

export interface DistributedLockOptions {
  ttlMs?: number; // Time To Live in milliseconds (기본: 20분)
  retryDelayMs?: number; // 락 획득 재시도 대기 시간 (기본: 1초)
  maxRetries?: number; // 최대 재시도 횟수 (기본: 3)
}

/**
 * DB 기반 분산 락 서비스
 */
export class DistributedLockService {
  constructor(private prisma: PrismaClient) {}

  /**
   * 락 획득
   * @param lockKey - 락 식별자 (예: 'sync')
   * @param owner - 락 소유자 식별자 (예: request ID, process ID)
   * @param options - 락 옵션
   * @returns 락 획득 성공 여부
   */
  async acquire(
    lockKey: string,
    owner: string,
    options: DistributedLockOptions = {}
  ): Promise<boolean> {
    const { ttlMs = 20 * 60 * 1000, retryDelayMs = 1000, maxRetries = 3 } = options;
    const expiresAt = new Date(Date.now() + ttlMs);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // 1. 만료된 락 정리
        await this.cleanupExpired();

        // 2. 락 획득 시도 (upsert with unique constraint)
        await this.prisma.distributedLock.create({
          data: {
            lockKey,
            owner,
            expiresAt,
          },
        });

        return true;
      } catch (error) {
        // Unique constraint 위반 = 이미 락이 존재
        if (
          error instanceof Error &&
          (error.message.includes('Unique constraint') ||
            error.message.includes('unique_violation'))
        ) {
          // 마지막 시도가 아니면 재시도
          if (attempt < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
            continue;
          }
          return false;
        }

        // 다른 에러는 throw
        throw error;
      }
    }

    return false;
  }

  /**
   * 락 해제
   * @param lockKey - 락 식별자
   * @param owner - 락 소유자 (본인만 해제 가능)
   * @returns 락 해제 성공 여부
   */
  async release(lockKey: string, owner: string): Promise<boolean> {
    try {
      const result = await this.prisma.distributedLock.deleteMany({
        where: {
          lockKey,
          owner,
        },
      });

      return result.count > 0;
    } catch (error) {
      // 락 해제 실패는 로그만 남기고 무시 (TTL로 자동 정리됨)
      console.error(`Failed to release lock ${lockKey} for owner ${owner}:`, error);
      return false;
    }
  }

  /**
   * 락 갱신 (heartbeat)
   * @param lockKey - 락 식별자
   * @param owner - 락 소유자
   * @param ttlMs - 추가 TTL
   * @returns 갱신 성공 여부
   */
  async renew(lockKey: string, owner: string, ttlMs: number = 20 * 60 * 1000): Promise<boolean> {
    try {
      const expiresAt = new Date(Date.now() + ttlMs);

      const result = await this.prisma.distributedLock.updateMany({
        where: {
          lockKey,
          owner,
        },
        data: {
          expiresAt,
        },
      });

      return result.count > 0;
    } catch (error) {
      console.error(`Failed to renew lock ${lockKey} for owner ${owner}:`, error);
      return false;
    }
  }

  /**
   * 만료된 락 정리
   */
  private async cleanupExpired(): Promise<void> {
    try {
      await this.prisma.distributedLock.deleteMany({
        where: {
          expiresAt: {
            lt: new Date(),
          },
        },
      });
    } catch (error) {
      console.error('Failed to cleanup expired locks:', error);
    }
  }

  /**
   * 락 상태 확인
   * @param lockKey - 락 식별자
   * @returns 락 정보 (없으면 null)
   */
  async getInfo(lockKey: string): Promise<{
    owner: string;
    acquiredAt: Date;
    expiresAt: Date;
  } | null> {
    try {
      const lock = await this.prisma.distributedLock.findUnique({
        where: { lockKey },
      });

      if (!lock) {
        return null;
      }

      // 만료된 락은 null 반환
      if (lock.expiresAt < new Date()) {
        await this.prisma.distributedLock.delete({
          where: { lockKey },
        });
        return null;
      }

      return {
        owner: lock.owner,
        acquiredAt: lock.acquiredAt,
        expiresAt: lock.expiresAt,
      };
    } catch (error) {
      console.error(`Failed to get lock info for ${lockKey}:`, error);
      return null;
    }
  }
}

/**
 * 락을 사용한 안전한 함수 실행 (자동 갱신 포함)
 * @param prisma - Prisma 클라이언트
 * @param lockKey - 락 식별자
 * @param owner - 락 소유자 식별자
 * @param fn - 실행할 함수
 * @param options - 락 옵션
 * @returns 함수 실행 결과
 */
export async function withDistributedLock<T>(
  prisma: PrismaClient,
  lockKey: string,
  owner: string,
  fn: () => Promise<T>,
  options: DistributedLockOptions = {}
): Promise<T> {
  const lockService = new DistributedLockService(prisma);
  const { ttlMs = 20 * 60 * 1000 } = options;

  // 락 획득 시도
  const acquired = await lockService.acquire(lockKey, owner, options);

  if (!acquired) {
    const info = await lockService.getInfo(lockKey);
    const ownerInfo = info?.owner ?? 'unknown';
    const timeInfo = info?.acquiredAt?.toISOString() ?? 'unknown time';
    throw new Error(
      `Lock '${lockKey}' is already acquired by '${ownerInfo}' at ${timeInfo}`
    );
  }

  // 자동 락 갱신 (heartbeat)
  // TTL의 절반마다 갱신 (예: 20분 TTL → 10분마다 갱신)
  const renewIntervalMs = Math.floor(ttlMs / 2);
  let lockLost = false;
  let lockLostError: Error | null = null;

  const heartbeatInterval = setInterval(async () => {
    try {
      const renewed = await lockService.renew(lockKey, owner, ttlMs);
      if (!renewed) {
        // 락 갱신 실패 = 락이 만료되었거나 다른 프로세스가 삭제
        // 즉시 작업을 중단해야 함
        lockLost = true;
        lockLostError = new Error(
          `Lock '${lockKey}' renewal failed for owner '${owner}'. ` +
          `The lock may have expired or been taken by another process. ` +
          `Aborting operation to prevent concurrent execution.`
        );
        console.error(lockLostError.message);
      }
    } catch (error) {
      lockLost = true;
      lockLostError = new Error(
        `Error renewing lock ${lockKey}: ${error instanceof Error ? error.message : String(error)}`
      );
      console.error(lockLostError.message);
    }
  }, renewIntervalMs);

  try {
    // 함수 실행
    const result = await fn();

    // 함수 실행 완료 후 락 손실 확인
    if (lockLost && lockLostError) {
      throw lockLostError;
    }

    return result;
  } finally {
    // heartbeat 중지
    clearInterval(heartbeatInterval);

    // 락 해제 (항상 실행)
    await lockService.release(lockKey, owner);
  }
}
