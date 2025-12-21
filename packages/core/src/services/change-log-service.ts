/**
 * ChangeLogService - 주문 변경 이력 관리
 * Issue #136 Phase 2: 변경 이력 로그 + 충돌 감지
 */

import type { PrismaClient, OrderChangeLog } from '@prisma/client';

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
  action: 'update' | 'status_change' | 'delete' | 'restore' | 'conflict_detected';
  fieldChanges: Record<string, FieldChange>;
  previousVersion: number;
  conflictDetected?: boolean;
  conflictResolution?: 'db_wins' | 'sheet_wins' | 'manual';
}

/**
 * 변경 로그 조회 옵션
 */
export interface GetChangeLogsOptions {
  limit?: number;
  offset?: number;
}

/**
 * 충돌 조회 옵션
 */
export interface GetConflictsOptions {
  resolved?: boolean;
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
   * @note conflict_detected 액션은 version을 증가시키지 않음 (데이터 변경 없음)
   */
  async logChange(params: LogChangeParams): Promise<OrderChangeLog> {
    const {
      orderId,
      sheetRowNumber,
      changedBy,
      action,
      fieldChanges,
      previousVersion,
      conflictDetected = false,
      conflictResolution,
    } = params;

    // 충돌 감지 로그는 version을 증가시키지 않음 (실제 데이터 변경 없음)
    const isConflictLog = action === 'conflict_detected';
    const newVersion = isConflictLog ? previousVersion : previousVersion + 1;

    // 변경 로그 생성
    const changeLog = await this.prisma.orderChangeLog.create({
      data: {
        orderId,
        sheetRowNumber,
        changedBy,
        action,
        fieldChanges: fieldChanges as object,
        previousVersion,
        newVersion,
        conflictDetected,
        // 충돌 감지 시 resolution은 null로 시작 (미해결 상태)
        conflictResolution: isConflictLog ? null : conflictResolution,
      },
    });

    // 충돌 감지 로그가 아닌 경우에만 Order 메타데이터 업데이트
    if (!isConflictLog) {
      await this.prisma.order.update({
        where: { id: orderId },
        data: {
          version: newVersion,
          lastModifiedBy: changedBy,
          lastModifiedAt: new Date(),
        },
      });
    }

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
   * 충돌 이력 조회
   * @param options - 조회 옵션
   */
  async getConflicts(options?: GetConflictsOptions): Promise<OrderChangeLog[]> {
    const where: { conflictDetected: boolean; conflictResolution?: null | { not: null } } = {
      conflictDetected: true,
    };

    // resolved 옵션에 따라 필터링
    if (options?.resolved === true) {
      where.conflictResolution = { not: null };
    } else if (options?.resolved === false) {
      where.conflictResolution = null;
    }

    return this.prisma.orderChangeLog.findMany({
      where,
      orderBy: { changedAt: 'desc' },
      take: options?.limit,
      skip: options?.offset,
      include: {
        order: {
          select: {
            id: true,
            sheetRowNumber: true,
            recipientName: true,
            status: true,
          },
        },
      },
    });
  }

  /**
   * 충돌 해결 처리
   * @param changeLogId - 변경 로그 ID
   * @param resolution - 해결 방법
   */
  async resolveConflict(changeLogId: number, resolution: 'db_wins' | 'sheet_wins' | 'manual'): Promise<OrderChangeLog> {
    return this.prisma.orderChangeLog.update({
      where: { id: changeLogId },
      data: { conflictResolution: resolution },
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
