/**
 * DatabaseService
 *
 * PostgreSQL 기반 데이터베이스 서비스
 * SheetService와 동일한 인터페이스 제공하여 기존 API와 호환
 *
 * Issue #68 Phase 2.1: Google Sheets → PostgreSQL 하이브리드 시스템
 */

import { PrismaClient } from '@prisma/client';
import type { SheetRow, OrderStatus } from '../types/order.js';
import { parseKoreanTimestamp, validateProductSelection, extractQuantity, normalizeOrderStatus } from '../types/order.js';
import type { Config } from '../config/config.js';

// Prisma Order 타입 정의 (runtime에서 자동 추론됨)
type PrismaOrder = Awaited<ReturnType<PrismaClient['order']['findUnique']>> & object;

/**
 * PostgreSQL 기반 데이터베이스 서비스
 * SheetService와 동일한 인터페이스 제공
 */
export class DatabaseService {
  private prisma: PrismaClient;
  private ownsPrisma: boolean;

  constructor(_config: Config, prisma?: PrismaClient) {
    // config는 미래 확장용으로 보관

    // PrismaClient 자체 생성 또는 주입 (테스트 용이성)
    if (prisma) {
      this.prisma = prisma;
      this.ownsPrisma = false;
    } else {
      this.prisma = new PrismaClient();
      this.ownsPrisma = true;
    }
  }

  /**
   * Prisma Order → SheetRow 변환
   * 기존 API와의 호환성 유지
   */
  private prismaOrderToSheetRow(order: PrismaOrder): SheetRow {
    return {
      '타임스탬프': order.timestampRaw,
      '비고': normalizeOrderStatus(order.status),
      '보내는분 성함': order.senderName,
      '보내는분 주소 (도로명 주소로 부탁드려요)': order.senderAddress,
      '보내는분 연락처 (핸드폰번호)': order.senderPhone,
      '받으실분 성함': order.recipientName,
      '받으실분 주소 (도로명 주소로 부탁드려요)': order.recipientAddress,
      '받으실분 연락처 (핸드폰번호)': order.recipientPhone,
      '상품 선택': order.productSelection,
      '5kg 수량': order.quantity5kg,
      '10kg 수량': order.quantity10kg,
      _rowNumber: order.sheetRowNumber || undefined,
      _validationError: order.validationError || undefined,
      _syncAttemptCount: order.syncAttemptCount,
      '삭제됨': order.deletedAt?.toISOString(),
      _isDeleted: !!order.deletedAt,
    };
  }

  /**
   * SheetRow → Prisma Order 데이터 변환 (싱크 시 사용)
   * 주의: 이 메서드는 DB insert용 데이터만 생성, 실제 insert는 호출자가 수행
   */
  sheetRowToPrismaOrderData(row: SheetRow) {
    // sheetRowNumber 검증 - Phase 2.1에서는 필수
    if (!row._rowNumber) {
      throw new Error(
        'sheetRowNumber (_rowNumber) is required for sync operations. ' +
        'Direct DB inserts without sheet row numbers are not yet supported in Phase 2.1.'
      );
    }

    const timestamp = parseKoreanTimestamp(row['타임스탬프']);
    const quantity = extractQuantity(row);

    // 상품 타입 검증
    const productSelection = row['상품 선택'] || '';
    const validation = validateProductSelection(productSelection);

    // Soft Delete 처리: 시트의 '삭제됨' 값을 deletedAt으로 변환
    // - '삭제됨' 컬럼이 존재하고 값이 있음 → 해당 날짜로 soft delete
    // - '삭제됨' 컬럼이 존재하고 빈값 → 복원 (deletedAt = null)
    // - '삭제됨' 컬럼이 없음 → 기존 DB 값 유지 (deletedAt = undefined)
    // - _isDeleted 플래그만 있음 → 현재 시각으로 soft delete
    let deletedAt: Date | null | undefined = undefined;
    const hasDeletedColumn = Object.prototype.hasOwnProperty.call(row, '삭제됨');

    if (hasDeletedColumn) {
      const deletedValue = row['삭제됨'];
      if (deletedValue && deletedValue.trim() !== '') {
        try {
          const parsedDate = new Date(deletedValue);
          // Invalid Date 체크
          if (!isNaN(parsedDate.getTime())) {
            deletedAt = parsedDate;
          } else {
            // 유효하지 않은 날짜 → 컬럼이 있으므로 복원 처리 (P2 방어)
            deletedAt = null;
          }
        } catch {
          // 파싱 실패 → 컬럼이 있으므로 복원 처리
          deletedAt = null;
        }
      } else {
        // 빈값 = 명시적 복원
        deletedAt = null;
      }
    } else if (row._isDeleted) {
      // _isDeleted 플래그만 있는 경우 현재 시각 사용
      deletedAt = new Date();
    }
    // else: deletedAt = undefined (기존 DB 값 유지)

    return {
      sheetRowNumber: row._rowNumber,
      timestamp,
      timestampRaw: row['타임스탬프'],
      senderName: row['보내는분 성함'],
      senderAddress: row['보내는분 주소 (도로명 주소로 부탁드려요)'],
      senderPhone: row['보내는분 연락처 (핸드폰번호)'],
      recipientName: row['받으실분 성함'],
      recipientAddress: row['받으실분 주소 (도로명 주소로 부탁드려요)'],
      recipientPhone: row['받으실분 연락처 (핸드폰번호)'],
      productSelection,
      productType: validation.productType || null,
      quantity5kg: String(row['5kg 수량'] || ''),
      quantity10kg: String(row['10kg 수량'] || ''),
      quantity,
      status: row['비고'] || '',
      validationError: validation.isValid ? null : validation.reason,
      deletedAt, // Phase 3: Soft Delete 동기화 (undefined = 기존 값 유지)
      // syncStatus는 호출자(SyncEngine)에서 설정
    };
  }

  /**
   * Status별 주문 조회
   * SheetService.getOrdersByStatus()와 동일한 인터페이스
   *
   * Phase 3: 3단계 상태 체계
   * - 'new' → 신규주문 (비고 = '신규주문' 또는 빈 문자열)
   * - 'pending_payment' → 입금확인 (비고 = '입금확인')
   * - 'completed' → 배송완료 (비고 = '배송완료' 또는 '확인')
   * - 'all' → 모든 상태
   *
   * @param includeDeleted - Soft Delete된 주문 포함 여부 (기본: false)
   */
  async getOrdersByStatus(
    status: 'new' | 'pending_payment' | 'completed' | 'all' = 'new',
    includeDeleted: boolean = false
  ): Promise<SheetRow[]> {
    try {
      // 기본 조건: Soft Delete 제외
      const baseWhere = includeDeleted ? {} : { deletedAt: null };

      let statusWhere = {};

      switch (status) {
        case 'completed':
          // 배송완료 (하위 호환: '확인'도 포함)
          statusWhere = { status: { in: ['배송완료', '확인'] } };
          break;
        case 'pending_payment':
          // 입금확인
          statusWhere = { status: '입금확인' };
          break;
        case 'new':
          // 신규주문 (하위 호환: 빈 문자열도 포함)
          statusWhere = { status: { in: ['신규주문', ''] } };
          break;
        case 'all':
        default:
          statusWhere = {};
          break;
      }

      const orders = await this.prisma.order.findMany({
        where: { ...baseWhere, ...statusWhere },
        orderBy: { timestamp: 'desc' },
      });

      return orders.map((order: PrismaOrder) => this.prismaOrderToSheetRow(order));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get orders by status '${status}': ${message}`);
    }
  }

  /**
   * 새로운 주문만 조회 (하위 호환성)
   */
  async getNewOrders(): Promise<SheetRow[]> {
    return this.getOrdersByStatus('new');
  }

  /**
   * 모든 행 조회
   * @param includeDeleted - Soft Delete된 주문 포함 여부 (기본: false)
   */
  async getAllRows(includeDeleted: boolean = false): Promise<SheetRow[]> {
    return this.getOrdersByStatus('all', includeDeleted);
  }

  /**
   * 특정 행 번호로 주문 조회
   */
  async getOrderByRowNumber(rowNumber: number): Promise<SheetRow | null> {
    try {
      const order = await this.prisma.order.findUnique({
        where: { sheetRowNumber: rowNumber },
      });

      if (!order) {
        return null;
      }

      return this.prismaOrderToSheetRow(order);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get order by row number ${rowNumber}: ${message}`);
    }
  }

  /**
   * 주문 배송완료 처리
   * Phase 3: '확인' → '배송완료'로 변경 (하위 호환성 유지)
   * @param rowNumbers - 처리할 행 번호 배열 (선택). 미제공 시 모든 신규 주문 처리
   */
  async markAsConfirmed(rowNumbers?: number[]): Promise<void> {
    try {
      if (rowNumbers && rowNumbers.length > 0) {
        // 특정 행만 배송완료 처리
        await this.prisma.order.updateMany({
          where: {
            sheetRowNumber: { in: rowNumbers },
            deletedAt: null, // Soft Delete된 주문 제외
          },
          data: {
            status: '배송완료',
            updatedAt: new Date(),
          },
        });
      } else {
        // 모든 미완료 주문 배송완료 처리 (하위 호환성)
        await this.prisma.order.updateMany({
          where: {
            status: { notIn: ['배송완료', '확인'] },
            deletedAt: null,
          },
          data: {
            status: '배송완료',
            updatedAt: new Date(),
          },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const context = rowNumbers ? `rows ${rowNumbers.join(', ')}` : 'all incomplete orders';
      throw new Error(`Failed to mark as delivered (${context}): ${message}`);
    }
  }

  /**
   * 단일 주문 배송완료 처리 (SheetService 호환)
   * @param rowNumber - 처리할 행 번호
   */
  async markSingleAsConfirmed(rowNumber: number): Promise<void> {
    return this.markAsConfirmed([rowNumber]);
  }

  /**
   * 주문 상태 변경 (Phase 3)
   * @param rowNumber - 행 번호
   * @param newStatus - 새 상태 ('신규주문' | '입금확인' | '배송완료')
   */
  async updateOrderStatus(rowNumber: number, newStatus: OrderStatus): Promise<void> {
    try {
      await this.prisma.order.updateMany({
        where: {
          sheetRowNumber: rowNumber,
          deletedAt: null,
        },
        data: {
          status: newStatus,
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to update order status (row: ${rowNumber}, status: ${newStatus}): ${message}`);
    }
  }

  /**
   * 입금확인 처리 (Phase 3)
   * @param rowNumbers - 처리할 행 번호 배열
   */
  async markPaymentConfirmed(rowNumbers: number[]): Promise<void> {
    try {
      await this.prisma.order.updateMany({
        where: {
          sheetRowNumber: { in: rowNumbers },
          deletedAt: null,
        },
        data: {
          status: '입금확인',
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to mark payment confirmed (rows: ${rowNumbers.join(', ')}): ${message}`);
    }
  }

  /**
   * 배송완료 처리 (Phase 3)
   * @param rowNumbers - 처리할 행 번호 배열
   */
  async markDelivered(rowNumbers: number[]): Promise<void> {
    try {
      await this.prisma.order.updateMany({
        where: {
          sheetRowNumber: { in: rowNumbers },
          deletedAt: null,
        },
        data: {
          status: '배송완료',
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to mark as delivered (rows: ${rowNumbers.join(', ')}): ${message}`);
    }
  }

  /**
   * Soft Delete (Phase 3)
   * @param rowNumbers - 삭제할 행 번호 배열
   */
  async softDelete(rowNumbers: number[]): Promise<void> {
    try {
      await this.prisma.order.updateMany({
        where: {
          sheetRowNumber: { in: rowNumbers },
          deletedAt: null, // 이미 삭제된 주문은 건너뜀
        },
        data: {
          deletedAt: new Date(),
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to soft delete orders (rows: ${rowNumbers.join(', ')}): ${message}`);
    }
  }

  /**
   * Soft Delete 복원 (Phase 3)
   * @param rowNumbers - 복원할 행 번호 배열
   */
  async restore(rowNumbers: number[]): Promise<void> {
    try {
      await this.prisma.order.updateMany({
        where: {
          sheetRowNumber: { in: rowNumbers },
          deletedAt: { not: null }, // 삭제된 주문만
        },
        data: {
          deletedAt: null,
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to restore orders (rows: ${rowNumbers.join(', ')}): ${message}`);
    }
  }

  /**
   * 삭제된 주문만 조회 (Phase 3)
   */
  async getDeletedOrders(): Promise<SheetRow[]> {
    try {
      const orders = await this.prisma.order.findMany({
        where: { deletedAt: { not: null } },
        orderBy: { deletedAt: 'desc' },
      });

      return orders.map((order: PrismaOrder) => this.prismaOrderToSheetRow(order));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get deleted orders: ${message}`);
    }
  }

  /**
   * 특정 셀 업데이트 (SheetService 호환)
   * @param rowNumber - 행 번호
   * @param columnName - 컬럼명 (한글 또는 영문 매핑)
   * @param value - 업데이트할 값
   */
  async updateCell(rowNumber: number, columnName: string, value: string): Promise<void> {
    try {
      // 컬럼명 매핑 (한글 → DB 필드)
      const columnMap: Record<string, string> = {
        '비고': 'status',
        'DB_SYNC_STATUS': 'syncStatus',
        'DB_SYNC_AT': 'syncedAt',
        'DB_SYNC_ID': 'id',
      };

      const dbField = columnMap[columnName] || columnName;

      // 동적 업데이트 (타입 안전성 제한적)
      await this.prisma.order.updateMany({
        where: { sheetRowNumber: rowNumber },
        data: {
          [dbField]: value,
          updatedAt: new Date(),
        } as any,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to update cell (row: ${rowNumber}, column: ${columnName}): ${message}`
      );
    }
  }

  /**
   * 주문 생성 또는 업데이트 (싱크 서비스용)
   * sheetRowNumber를 기준으로 upsert 수행
   *
   * 주의: syncStatus, syncAttemptCount는 호출자(SyncEngine)가 관리
   */
  async upsertOrder(row: SheetRow, syncMeta?: {
    syncStatus: 'pending' | 'success' | 'failed';
    syncAttemptCount?: number;
    syncErrorMessage?: string;
  }): Promise<PrismaOrder> {
    try {
      const data = this.sheetRowToPrismaOrderData(row);

      // syncMeta가 제공되면 사용, 아니면 기본값
      const syncData = syncMeta || {
        syncStatus: 'success',
        syncAttemptCount: 1,
        syncedAt: new Date(),
      };

      // P1 Fix: deletedAt 처리
      // - undefined: 시트에 '삭제됨' 컬럼 없음 → update에서 제외 (기존 DB 값 유지)
      // - null: 시트에서 명시적 빈값 → update에 포함 (복원)
      // - Date: 삭제 날짜 → update에 포함 (soft delete)
      const { deletedAt, ...dataWithoutDeletedAt } = data;
      let updateData;
      if (deletedAt === undefined) {
        // 시트에 삭제 정보 없음 → 기존 DB soft delete 유지
        updateData = { ...dataWithoutDeletedAt, ...syncData, syncedAt: new Date() };
      } else {
        // deletedAt이 null(복원) 또는 Date(삭제) → 업데이트에 포함
        updateData = { ...dataWithoutDeletedAt, deletedAt, ...syncData, syncedAt: new Date() };
      }

      const result = await this.prisma.order.upsert({
        where: { sheetRowNumber: data.sheetRowNumber },
        create: {
          ...data,
          ...syncData,
          syncedAt: new Date(),
        },
        update: updateData,
      });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const rowNum = row._rowNumber || 'unknown';
      throw new Error(`Failed to upsert order (row: ${rowNum}): ${message}`);
    }
  }

  /**
   * 연결 종료 (앱 종료 시)
   * 자체 생성한 PrismaClient만 종료
   */
  async disconnect(): Promise<void> {
    if (this.ownsPrisma) {
      await this.prisma.$disconnect();
    }
  }
}
