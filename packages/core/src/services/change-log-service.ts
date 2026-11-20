/**
 * ChangeLogService - 주문 변경 이력 관리
 * Issue #136 Phase 2: 변경 이력 로그
 *
 * #228: 웹-시트 "충돌" 개념은 폐지됐다(hybrid 정본 = DB · #281). 예전 `conflict_detected` 로그와
 * `conflictDetected` · `conflictResolution` 컬럼은 이력으로 남고 조회 응답에도 그대로 나가지만, 새로 쓰지 않는다.
 */

import type { Prisma, PrismaClient, OrderChangeLog } from '@prisma/client';

/** 루트 클라이언트 또는 `$transaction` 안의 트랜잭션 클라이언트 (#197) */
export type PrismaWriter = PrismaClient | Prisma.TransactionClient;

/**
 * 필드 변경 정보
 */
export interface FieldChange {
  old: unknown;
  new: unknown;
}

/**
 * 변경 로그 생성 파라미터
 */
export interface LogChangeParams {
  orderId: number;
  sheetRowNumber: number;
  changedBy: 'web' | 'sync' | 'api';
  action: 'update' | 'status_change' | 'delete' | 'restore';
  fieldChanges: Record<string, FieldChange>;
  previousVersion: number;
}

/**
 * 변경 로그 조회 옵션
 */
export interface GetChangeLogsOptions {
  limit?: number;
  offset?: number;
}

/**
 * 변경 이력 관리 서비스
 */
export class ChangeLogService {
  constructor(private prisma: PrismaClient) {}

  /**
   * 변경 이력 기록
   * @param params - 변경 로그 파라미터
   * @param client - 트랜잭션 안에서 부를 때 넘긴다 — 데이터 변경과 이력이 함께 커밋·롤백된다 (#197)
   */
  async logChange(params: LogChangeParams, client: PrismaWriter = this.prisma): Promise<OrderChangeLog> {
    const { orderId, sheetRowNumber, changedBy, action, fieldChanges, previousVersion } = params;
    const newVersion = previousVersion + 1;

    // 변경 로그 생성
    const changeLog = await client.orderChangeLog.create({
      data: {
        orderId,
        sheetRowNumber,
        changedBy,
        action,
        fieldChanges: fieldChanges as object,
        previousVersion,
        newVersion,
      },
    });

    await client.order.update({
      where: { id: orderId },
      data: {
        version: newVersion,
        lastModifiedBy: changedBy,
        lastModifiedAt: new Date(),
      },
    });

    return changeLog;
  }

  /**
   * 주문의 변경 이력 조회
   * @param orderId - 주문 ID
   * @param options - 조회 옵션
   */
  async getChangeLogs(orderId: number, options?: GetChangeLogsOptions): Promise<OrderChangeLog[]> {
    return this.prisma.orderChangeLog.findMany({
      where: { orderId },
      orderBy: { changedAt: 'desc' },
      take: options?.limit,
      skip: options?.offset,
    });
  }

  /**
   * 시트 행 번호로 변경 이력 조회
   * @param sheetRowNumber - 시트 행 번호
   * @param options - 조회 옵션
   */
  async getChangeLogsByRowNumber(sheetRowNumber: number, options?: GetChangeLogsOptions): Promise<OrderChangeLog[]> {
    return this.prisma.orderChangeLog.findMany({
      where: { sheetRowNumber },
      orderBy: { changedAt: 'desc' },
      take: options?.limit,
      skip: options?.offset,
    });
  }

  /**
   * 필드 변경사항 계산 (before/after 비교)
   * @param before - 변경 전 객체
   * @param after - 변경 후 객체
   * @param fieldsToCompare - 비교할 필드 목록
   */
  calculateFieldChanges(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    fieldsToCompare: string[]
  ): Record<string, FieldChange> {
    const changes: Record<string, FieldChange> = {};

    for (const field of fieldsToCompare) {
      const oldValue = before[field];
      const newValue = after[field];

      // 값이 다를 경우에만 기록
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        changes[field] = {
          old: oldValue ?? null,
          new: newValue ?? null,
        };
      }
    }

    return changes;
  }
}
