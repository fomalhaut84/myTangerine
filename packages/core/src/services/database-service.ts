/**
 * DatabaseService
 *
 * PostgreSQL 기반 데이터베이스 서비스
 * SheetService와 동일한 인터페이스 제공하여 기존 API와 호환
 *
 * Issue #68 Phase 2.1: Google Sheets → PostgreSQL 하이브리드 시스템
 */

import { PrismaClient } from '@prisma/client';
import type { SheetRow } from '../types/order.js';
import { parseKoreanTimestamp, validateProductSelection, extractQuantity } from '../types/order.js';
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
      '비고': order.status,
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
      // syncStatus는 호출자(SyncEngine)에서 설정
    };
  }

  /**
   * Status별 주문 조회
   * SheetService.getOrdersByStatus()와 동일한 인터페이스
   */
  async getOrdersByStatus(status: 'new' | 'completed' | 'all' = 'new'): Promise<SheetRow[]> {
    try {
      let where = {};

      switch (status) {
        case 'completed':
          where = { status: '확인' };
          break;
        case 'new':
          where = { status: { not: '확인' } };
          break;
        case 'all':
        default:
          where = {};
          break;
      }

      const orders = await this.prisma.order.findMany({
        where,
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
   */
  async getAllRows(): Promise<SheetRow[]> {
    return this.getOrdersByStatus('all');
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
   * 주문 확인 처리
   * @param rowNumbers - 확인 처리할 행 번호 배열 (선택). 미제공 시 모든 신규 주문 확인
   */
  async markAsConfirmed(rowNumbers?: number[]): Promise<void> {
    try {
      if (rowNumbers && rowNumbers.length > 0) {
        // 특정 행만 확인
        await this.prisma.order.updateMany({
          where: {
            sheetRowNumber: { in: rowNumbers },
          },
          data: {
            status: '확인',
            updatedAt: new Date(),
          },
        });
      } else {
        // 모든 미확인 주문 확인 (하위 호환성)
        await this.prisma.order.updateMany({
          where: {
            status: { not: '확인' },
          },
          data: {
            status: '확인',
            updatedAt: new Date(),
          },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const context = rowNumbers ? `rows ${rowNumbers.join(', ')}` : 'all new orders';
      throw new Error(`Failed to mark as confirmed (${context}): ${message}`);
    }
  }

  /**
   * 단일 주문 확인 처리 (SheetService 호환)
   * @param rowNumber - 확인 처리할 행 번호
   */
  async markSingleAsConfirmed(rowNumber: number): Promise<void> {
    return this.markAsConfirmed([rowNumber]);
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

      const result = await this.prisma.order.upsert({
        where: { sheetRowNumber: data.sheetRowNumber },
        create: {
          ...data,
          ...syncData,
          syncedAt: new Date(),
        },
        update: {
          ...data,
          ...syncData,
          syncedAt: new Date(),
          // syncAttemptCount는 증가하지 않고 syncMeta에서 제공된 값 사용
        },
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
