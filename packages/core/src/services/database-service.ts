/**
 * DatabaseService
 *
 * PostgreSQL 기반 데이터베이스 서비스
 * SheetService와 동일한 인터페이스 제공하여 기존 API와 호환
 *
 * Issue #68 Phase 2.1: Google Sheets → PostgreSQL 하이브리드 시스템
 */

import type { PrismaClient, Order as PrismaOrder } from '@prisma/client';
import type { SheetRow } from '../types/order.js';
import { parseKoreanTimestamp, validateProductSelection, extractQuantity } from '../types/order.js';
import type { Config } from '../config/config.js';

/**
 * PostgreSQL 기반 데이터베이스 서비스
 * SheetService와 동일한 인터페이스 제공
 */
export class DatabaseService {
  private prisma: PrismaClient;
  private config: Config;

  constructor(config: Config, prisma?: PrismaClient) {
    this.config = config;
    // 테스트에서 주입 가능하도록 옵션 처리
    if (!prisma) {
      // @ts-ignore - Prisma Client는 런타임에서만 사용 가능
      throw new Error('PrismaClient must be provided to DatabaseService');
    }
    this.prisma = prisma;
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
      _rowNumber: order.sheetRowNumber,
      _validationError: order.validationError || undefined,
    };
  }

  /**
   * SheetRow → Prisma Order 데이터 변환 (싱크 시 사용)
   * 주의: 이 메서드는 DB insert용 데이터만 생성, 실제 insert는 호출자가 수행
   */
  sheetRowToPrismaOrderData(row: SheetRow) {
    const timestamp = parseKoreanTimestamp(row['타임스탬프']);
    const quantity = extractQuantity(row);

    // 상품 타입 검증
    const productSelection = row['상품 선택'] || '';
    const validation = validateProductSelection(productSelection);

    return {
      sheetRowNumber: row._rowNumber || 0,
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
      syncStatus: 'success',
      syncedAt: new Date(),
      syncAttemptCount: 0,
    };
  }

  /**
   * Status별 주문 조회
   * SheetService.getOrdersByStatus()와 동일한 인터페이스
   */
  async getOrdersByStatus(status: 'new' | 'completed' | 'all' = 'new'): Promise<SheetRow[]> {
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

    return orders.map((order) => this.prismaOrderToSheetRow(order));
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
    const order = await this.prisma.order.findUnique({
      where: { sheetRowNumber: rowNumber },
    });

    if (!order) {
      return null;
    }

    return this.prismaOrderToSheetRow(order);
  }

  /**
   * 주문 확인 처리
   * @param rowNumbers - 확인 처리할 행 번호 배열 (선택). 미제공 시 모든 신규 주문 확인
   */
  async markAsConfirmed(rowNumbers?: number[]): Promise<void> {
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
  }

  /**
   * 주문 생성 또는 업데이트 (싱크 서비스용)
   * sheetRowNumber를 기준으로 upsert 수행
   */
  async upsertOrder(row: SheetRow): Promise<PrismaOrder> {
    const data = this.sheetRowToPrismaOrderData(row);

    const result = await this.prisma.order.upsert({
      where: { sheetRowNumber: data.sheetRowNumber },
      create: data,
      update: {
        ...data,
        syncAttemptCount: { increment: 1 },
      },
    });

    return result;
  }

  /**
   * 연결 종료 (앱 종료 시)
   */
  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
