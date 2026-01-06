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
import { parseKoreanTimestamp, validateProductSelection, extractQuantity, normalizeOrderStatus, parseOrderType } from '../types/order.js';
import type { Config } from '../config/config.js';
import { ChangeLogService, type FieldChange } from './change-log-service.js';

// Prisma Order 타입 정의 (runtime에서 자동 추론됨)
type PrismaOrder = Awaited<ReturnType<PrismaClient['order']['findUnique']>> & object;

/**
 * PostgreSQL 기반 데이터베이스 서비스
 * SheetService와 동일한 인터페이스 제공
 */
export class DatabaseService {
  private _prisma: PrismaClient;
  private ownsPrisma: boolean;
  private _changeLogService: ChangeLogService | null = null;

  constructor(_config: Config, prisma?: PrismaClient) {
    // config는 미래 확장용으로 보관

    // PrismaClient 자체 생성 또는 주입 (테스트 용이성)
    if (prisma) {
      this._prisma = prisma;
      this.ownsPrisma = false;
    } else {
      this._prisma = new PrismaClient();
      this.ownsPrisma = true;
    }
  }

  /**
   * PrismaClient getter (외부 서비스에서 필요 시 사용)
   */
  get prisma(): PrismaClient {
    return this._prisma;
  }

  /**
   * ChangeLogService getter (lazy initialization)
   */
  get changeLogService(): ChangeLogService {
    if (!this._changeLogService) {
      this._changeLogService = new ChangeLogService(this._prisma);
    }
    return this._changeLogService;
  }

  /**
   * Prisma Order → SheetRow 변환
   * 기존 API와의 호환성 유지
   */
  private prismaOrderToSheetRow(order: PrismaOrder): SheetRow {
    return {
      '타임스탬프': order.timestampRaw,
      '비고': normalizeOrderStatus(order.status),
      '주문자 성함': order.ordererName || undefined,
      '이메일 주소': order.ordererEmail || undefined,
      '보내는분 성함': order.senderName,
      '보내는분 주소 (도로명 주소로 부탁드려요)': order.senderAddress,
      '보내는분 연락처 (핸드폰번호)': order.senderPhone,
      '받으실분 성함': order.recipientName,
      '받으실분 주소 (도로명 주소로 부탁드려요)': order.recipientAddress,
      '받으실분 연락처 (핸드폰번호)': order.recipientPhone,
      '상품 선택': order.productSelection,
      '5kg 수량': order.quantity5kg,
      '10kg 수량': order.quantity10kg,
      // Issue #131: 주문유형 추가 (선물/판매 구분)
      // Issue #152: 배송사고 유형 추가
      '주문유형': order.orderType === 'gift' ? '선물' : order.orderType === 'claim' ? '배송사고' : undefined,
      _rowNumber: order.sheetRowNumber || undefined,
      _validationError: order.validationError || undefined,
      _syncAttemptCount: order.syncAttemptCount,
      '삭제됨': order.deletedAt?.toISOString(),
      '송장번호': order.trackingNumber || undefined,
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
            // P1 Fix: 유효하지 않은 날짜 → 기존 DB 값 유지 (의도치 않은 복원 방지)
            console.warn(`[sheetRowToPrismaOrderData] Invalid deletedAt value: "${deletedValue}" (row: ${row._rowNumber})`);
            deletedAt = undefined;
          }
        } catch {
          // P1 Fix: 파싱 실패 → 기존 DB 값 유지
          console.warn(`[sheetRowToPrismaOrderData] Failed to parse deletedAt: "${deletedValue}" (row: ${row._rowNumber})`);
          deletedAt = undefined;
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

    // Issue #131: 주문유형 파싱 (선물/판매 구분)
    const orderType = parseOrderType(row['주문유형']);

    return {
      sheetRowNumber: row._rowNumber,
      timestamp,
      timestampRaw: row['타임스탬프'],
      ordererName: row['주문자 성함'] || null,
      ordererEmail: row['이메일 주소'] || null,
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
      // Issue #131: 주문유형 저장
      orderType,
      // P2 Fix: DB 저장 시 status 정규화하여 필터링과 일치
      // 공백 포함된 값(예: '확인 ')도 올바르게 분류
      status: normalizeOrderStatus(row['비고']),
      validationError: validation.isValid ? null : validation.reason,
      deletedAt, // Phase 3: Soft Delete 동기화 (undefined = 기존 값 유지)
      trackingNumber: row['송장번호'] || null, // P1 Fix: 송장번호 동기화 추가
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

      // P1 Fix: 레거시 상태값과 정규화된 값 모두 포함
      // - 기존 DB 레코드: '' (신규), '확인' (완료)
      // - 새 레코드 (정규화됨): '신규주문', '입금확인', '배송완료'
      switch (status) {
        case 'completed':
          // 배송완료: 정규화된 '배송완료' + 레거시 '확인'
          statusWhere = { status: { in: ['배송완료', '확인'] } };
          break;
        case 'pending_payment':
          // 입금확인: 정규화된 값만 (레거시에 없음)
          statusWhere = { status: '입금확인' };
          break;
        case 'new':
          // 신규주문: 정규화된 '신규주문' + 레거시 '' + 그 외 모든 값
          // notIn으로 완료/입금확인 제외
          statusWhere = { status: { notIn: ['배송완료', '확인', '입금확인'] } };
          break;
        case 'all':
        default:
          statusWhere = {};
          break;
      }

      const orders = await this._prisma.order.findMany({
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
      const order = await this._prisma.order.findUnique({
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
   * 특정 행 번호로 Raw Prisma Order 조회 (충돌 감지용)
   * Phase 2: 충돌 감지에 필요한 메타 필드 (lastModifiedBy, lastModifiedAt, version) 포함
   */
  async getRawOrderByRowNumber(rowNumber: number): Promise<PrismaOrder | null> {
    try {
      const order = await this._prisma.order.findUnique({
        where: { sheetRowNumber: rowNumber },
      });

      return order;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get raw order by row number ${rowNumber}: ${message}`);
    }
  }

  /**
   * 주문 배송완료 처리
   * Phase 3: '확인' → '배송완료'로 변경 (하위 호환성 유지)
   * @param rowNumbers - 처리할 행 번호 배열 (선택). 미제공 시 모든 신규 주문 처리
   * @param changedBy - 변경 주체
   */
  async markAsConfirmed(rowNumbers?: number[], changedBy: 'web' | 'sync' | 'api' = 'api'): Promise<void> {
    try {
      // 변경 전 주문 조회 (이력 기록용)
      const whereClause = rowNumbers && rowNumbers.length > 0
        ? { sheetRowNumber: { in: rowNumbers }, deletedAt: null }
        : { status: { notIn: ['배송완료', '확인'] }, deletedAt: null };

      const beforeOrders = await this._prisma.order.findMany({ where: whereClause });

      if (rowNumbers && rowNumbers.length > 0) {
        // 특정 행만 배송완료 처리
        await this._prisma.order.updateMany({
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
        await this._prisma.order.updateMany({
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

      // 각 주문에 대해 이력 기록
      for (const order of beforeOrders) {
        if (order.status !== '배송완료') {
          await this.changeLogService.logChange({
            orderId: order.id,
            sheetRowNumber: order.sheetRowNumber,
            changedBy,
            action: 'status_change',
            fieldChanges: {
              status: { old: order.status, new: '배송완료' },
            },
            previousVersion: order.version ?? 1,
          });
        }
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
   * @param changedBy - 변경 주체
   */
  async markSingleAsConfirmed(rowNumber: number, changedBy: 'web' | 'sync' | 'api' = 'api'): Promise<void> {
    return this.markAsConfirmed([rowNumber], changedBy);
  }

  /**
   * 주문 상태 변경 (Phase 3)
   * @param rowNumber - 행 번호
   * @param newStatus - 새 상태 ('신규주문' | '입금확인' | '배송완료')
   */
  async updateOrderStatus(
    rowNumber: number,
    newStatus: OrderStatus,
    changedBy: 'web' | 'sync' | 'api' = 'api'
  ): Promise<void> {
    try {
      // 변경 전 주문 조회
      const beforeOrder = await this._prisma.order.findFirst({
        where: { sheetRowNumber: rowNumber, deletedAt: null },
      });

      if (!beforeOrder) {
        throw new Error(`Order not found at row ${rowNumber}`);
      }

      // 상태가 동일하면 스킵
      if (beforeOrder.status === newStatus) {
        return;
      }

      // 상태 업데이트
      await this._prisma.order.updateMany({
        where: {
          sheetRowNumber: rowNumber,
          deletedAt: null,
        },
        data: {
          status: newStatus,
          updatedAt: new Date(),
        },
      });

      // 변경 이력 로깅
      await this.changeLogService.logChange({
        orderId: beforeOrder.id,
        sheetRowNumber: rowNumber,
        changedBy,
        action: 'status_change',
        fieldChanges: {
          status: { old: beforeOrder.status, new: newStatus },
        },
        previousVersion: beforeOrder.version,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to update order status (row: ${rowNumber}, status: ${newStatus}): ${message}`);
    }
  }

  /**
   * 입금확인 처리 (Phase 3)
   * @param rowNumbers - 처리할 행 번호 배열
   * @param changedBy - 변경 주체
   */
  async markPaymentConfirmed(rowNumbers: number[], changedBy: 'web' | 'sync' | 'api' = 'api'): Promise<void> {
    try {
      // 변경 전 주문 조회 (이력 기록용)
      const beforeOrders = await this._prisma.order.findMany({
        where: {
          sheetRowNumber: { in: rowNumbers },
          deletedAt: null,
        },
      });

      await this._prisma.order.updateMany({
        where: {
          sheetRowNumber: { in: rowNumbers },
          deletedAt: null,
        },
        data: {
          status: '입금확인',
          updatedAt: new Date(),
        },
      });

      // 각 주문에 대해 이력 기록
      for (const order of beforeOrders) {
        if (order.status !== '입금확인') {
          await this.changeLogService.logChange({
            orderId: order.id,
            sheetRowNumber: order.sheetRowNumber,
            changedBy,
            action: 'status_change',
            fieldChanges: {
              status: { old: order.status, new: '입금확인' },
            },
            previousVersion: order.version ?? 1,
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to mark payment confirmed (rows: ${rowNumbers.join(', ')}): ${message}`);
    }
  }

  /**
   * 배송완료 처리 (Phase 3)
   * @param rowNumbers - 처리할 행 번호 배열
   * @param trackingNumber - 송장번호 (선택)
   * @param changedBy - 변경 주체
   */
  async markDelivered(rowNumbers: number[], trackingNumber?: string, changedBy: 'web' | 'sync' | 'api' = 'api'): Promise<void> {
    try {
      // 변경 전 주문 조회 (이력 기록용)
      const beforeOrders = await this._prisma.order.findMany({
        where: {
          sheetRowNumber: { in: rowNumbers },
          deletedAt: null,
        },
      });

      await this._prisma.order.updateMany({
        where: {
          sheetRowNumber: { in: rowNumbers },
          deletedAt: null,
        },
        data: {
          status: '배송완료',
          ...(trackingNumber && { trackingNumber }),
          updatedAt: new Date(),
        },
      });

      // 각 주문에 대해 이력 기록
      for (const order of beforeOrders) {
        const fieldChanges: Record<string, { old: unknown; new: unknown }> = {};

        if (order.status !== '배송완료') {
          fieldChanges.status = { old: order.status, new: '배송완료' };
        }
        if (trackingNumber && order.trackingNumber !== trackingNumber) {
          fieldChanges.trackingNumber = { old: order.trackingNumber, new: trackingNumber };
        }

        if (Object.keys(fieldChanges).length > 0) {
          await this.changeLogService.logChange({
            orderId: order.id,
            sheetRowNumber: order.sheetRowNumber,
            changedBy,
            action: 'status_change',
            fieldChanges,
            previousVersion: order.version ?? 1,
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to mark as delivered (rows: ${rowNumbers.join(', ')}): ${message}`);
    }
  }

  /**
   * Soft Delete (Phase 3)
   * @param rowNumbers - 삭제할 행 번호 배열
   * @param changedBy - 변경 주체
   */
  async softDelete(rowNumbers: number[], changedBy: 'web' | 'sync' | 'api' = 'api'): Promise<void> {
    try {
      // 변경 전 주문 조회 (이력 기록용)
      const beforeOrders = await this._prisma.order.findMany({
        where: {
          sheetRowNumber: { in: rowNumbers },
          deletedAt: null,
        },
      });

      const deletedAt = new Date();

      await this._prisma.order.updateMany({
        where: {
          sheetRowNumber: { in: rowNumbers },
          deletedAt: null, // 이미 삭제된 주문은 건너뜀
        },
        data: {
          deletedAt,
          updatedAt: new Date(),
        },
      });

      // 각 주문에 대해 이력 기록
      for (const order of beforeOrders) {
        await this.changeLogService.logChange({
          orderId: order.id,
          sheetRowNumber: order.sheetRowNumber,
          changedBy,
          action: 'delete',
          fieldChanges: {
            deletedAt: { old: null, new: deletedAt.toISOString() },
          },
          previousVersion: order.version ?? 1,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to soft delete orders (rows: ${rowNumbers.join(', ')}): ${message}`);
    }
  }

  /**
   * Soft Delete 복원 (Phase 3)
   * @param rowNumbers - 복원할 행 번호 배열
   * @param changedBy - 변경 주체
   */
  async restore(rowNumbers: number[], changedBy: 'web' | 'sync' | 'api' = 'api'): Promise<void> {
    try {
      // 변경 전 주문 조회 (이력 기록용)
      const beforeOrders = await this._prisma.order.findMany({
        where: {
          sheetRowNumber: { in: rowNumbers },
          deletedAt: { not: null },
        },
      });

      await this._prisma.order.updateMany({
        where: {
          sheetRowNumber: { in: rowNumbers },
          deletedAt: { not: null }, // 삭제된 주문만
        },
        data: {
          deletedAt: null,
          updatedAt: new Date(),
        },
      });

      // 각 주문에 대해 이력 기록
      for (const order of beforeOrders) {
        await this.changeLogService.logChange({
          orderId: order.id,
          sheetRowNumber: order.sheetRowNumber,
          changedBy,
          action: 'restore',
          fieldChanges: {
            deletedAt: { old: order.deletedAt?.toISOString() ?? null, new: null },
          },
          previousVersion: order.version ?? 1,
        });
      }
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
      const orders = await this._prisma.order.findMany({
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
      await this._prisma.order.updateMany({
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

      const result = await this._prisma.order.upsert({
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
   * 주문 정보 수정 (Issue #136)
   * @param rowNumber - 행 번호 (1-based)
   * @param updates - 업데이트할 필드들
   * @param changedBy - 변경 주체 ('web' | 'sync' | 'api')
   */
  async updateOrder(
    rowNumber: number,
    updates: {
      sender?: { name?: string; phone?: string; address?: string };
      recipient?: { name?: string; phone?: string; address?: string };
      productType?: '5kg' | '10kg' | '비상품';
      quantity?: number;
      orderType?: 'customer' | 'gift' | 'claim';
      trackingNumber?: string;
    },
    changedBy: 'web' | 'sync' | 'api' = 'api'
  ): Promise<void> {
    try {
      // 1. 변경 전 주문 조회
      const beforeOrder = await this._prisma.order.findFirst({
        where: { sheetRowNumber: rowNumber, deletedAt: null },
      });

      if (!beforeOrder) {
        throw new Error(`Order not found at row ${rowNumber}`);
      }

      // Prisma 업데이트 데이터 구성
      const data: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      // 발송인 정보
      if (updates.sender) {
        if (updates.sender.name !== undefined) {
          data.senderName = updates.sender.name;
        }
        if (updates.sender.phone !== undefined) {
          data.senderPhone = updates.sender.phone;
        }
        if (updates.sender.address !== undefined) {
          data.senderAddress = updates.sender.address;
        }
      }

      // 수취인 정보
      if (updates.recipient) {
        if (updates.recipient.name !== undefined) {
          data.recipientName = updates.recipient.name;
        }
        if (updates.recipient.phone !== undefined) {
          data.recipientPhone = updates.recipient.phone;
        }
        if (updates.recipient.address !== undefined) {
          data.recipientAddress = updates.recipient.address;
        }
      }

      // 상품 정보
      if (updates.productType !== undefined) {
        data.productType = updates.productType;
      }

      // 수량 (5kg 또는 10kg 수량 필드에 저장)
      // 8차 리뷰: Prisma 스키마의 String 타입에 맞게 문자열로 저장
      if (updates.quantity !== undefined) {
        const productType = updates.productType || beforeOrder.productType;
        if (productType?.includes('5kg')) {
          data.quantity5kg = String(updates.quantity);
          data.quantity10kg = '0';
        } else if (productType?.includes('10kg')) {
          data.quantity10kg = String(updates.quantity);
          data.quantity5kg = '0';
        }
      }

      // 주문 유형
      if (updates.orderType !== undefined) {
        data.orderType = updates.orderType;
      }

      // 송장번호 (빈 문자열은 null로 변환하여 삭제)
      if (updates.trackingNumber !== undefined) {
        data.trackingNumber = updates.trackingNumber === '' ? null : updates.trackingNumber;
      }

      // 업데이트할 필드가 updatedAt만 있으면 종료
      if (Object.keys(data).length === 1) {
        return;
      }

      // 2. 업데이트 실행
      await this._prisma.order.updateMany({
        where: {
          sheetRowNumber: rowNumber,
          deletedAt: null,
        },
        data,
      });

      // 3. 변경 이력 계산 및 로깅
      const fieldChanges: Record<string, FieldChange> = {};

      // 발송인 정보 변경 감지
      if (updates.sender?.name !== undefined && updates.sender.name !== beforeOrder.senderName) {
        fieldChanges.senderName = { old: beforeOrder.senderName, new: updates.sender.name };
      }
      if (updates.sender?.phone !== undefined && updates.sender.phone !== beforeOrder.senderPhone) {
        fieldChanges.senderPhone = { old: beforeOrder.senderPhone, new: updates.sender.phone };
      }
      if (updates.sender?.address !== undefined && updates.sender.address !== beforeOrder.senderAddress) {
        fieldChanges.senderAddress = { old: beforeOrder.senderAddress, new: updates.sender.address };
      }

      // 수취인 정보 변경 감지
      if (updates.recipient?.name !== undefined && updates.recipient.name !== beforeOrder.recipientName) {
        fieldChanges.recipientName = { old: beforeOrder.recipientName, new: updates.recipient.name };
      }
      if (updates.recipient?.phone !== undefined && updates.recipient.phone !== beforeOrder.recipientPhone) {
        fieldChanges.recipientPhone = { old: beforeOrder.recipientPhone, new: updates.recipient.phone };
      }
      if (updates.recipient?.address !== undefined && updates.recipient.address !== beforeOrder.recipientAddress) {
        fieldChanges.recipientAddress = { old: beforeOrder.recipientAddress, new: updates.recipient.address };
      }

      // 주문 유형 변경 감지
      if (updates.orderType !== undefined && updates.orderType !== beforeOrder.orderType) {
        fieldChanges.orderType = { old: beforeOrder.orderType, new: updates.orderType };
      }

      // 송장번호 변경 감지
      if (updates.trackingNumber !== undefined) {
        const newTracking = updates.trackingNumber === '' ? null : updates.trackingNumber;
        if (newTracking !== beforeOrder.trackingNumber) {
          fieldChanges.trackingNumber = { old: beforeOrder.trackingNumber, new: newTracking };
        }
      }

      // 상품 타입 변경 감지 (6차 리뷰)
      if (updates.productType !== undefined && updates.productType !== beforeOrder.productType) {
        fieldChanges.productType = { old: beforeOrder.productType, new: updates.productType };
      }

      // 수량 변경 감지 (6차 + 7차 + 8차 리뷰)
      // productType 변경 시 반대 수량 필드 리셋도 기록
      // 8차 리뷰: 로그에도 String 타입으로 일관성 유지
      if (updates.quantity !== undefined) {
        const productType = updates.productType || beforeOrder.productType;
        const isProductTypeChanging = updates.productType !== undefined && updates.productType !== beforeOrder.productType;
        const newQtyStr = String(updates.quantity);

        if (productType?.includes('5kg')) {
          // 새 값이 5kg 수량으로 설정됨
          const old5kg = beforeOrder.quantity5kg ?? '';
          if (newQtyStr !== old5kg) {
            fieldChanges.quantity5kg = { old: old5kg, new: newQtyStr };
          }
          // productType 변경 시 10kg 수량이 0으로 리셋되는 것도 기록
          if (isProductTypeChanging) {
            const old10kg = beforeOrder.quantity10kg ?? '';
            if (old10kg !== '0' && old10kg !== '') {
              fieldChanges.quantity10kg = { old: old10kg, new: '0' };
            }
          }
        } else if (productType?.includes('10kg')) {
          // 새 값이 10kg 수량으로 설정됨
          const old10kg = beforeOrder.quantity10kg ?? '';
          if (newQtyStr !== old10kg) {
            fieldChanges.quantity10kg = { old: old10kg, new: newQtyStr };
          }
          // productType 변경 시 5kg 수량이 0으로 리셋되는 것도 기록
          if (isProductTypeChanging) {
            const old5kg = beforeOrder.quantity5kg ?? '';
            if (old5kg !== '0' && old5kg !== '') {
              fieldChanges.quantity5kg = { old: old5kg, new: '0' };
            }
          }
        }
      }

      // 변경사항이 있으면 로그 기록
      if (Object.keys(fieldChanges).length > 0) {
        await this.changeLogService.logChange({
          orderId: beforeOrder.id,
          sheetRowNumber: rowNumber,
          changedBy,
          action: 'update',
          fieldChanges,
          previousVersion: beforeOrder.version,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to update order (row: ${rowNumber}): ${message}`);
    }
  }

  /**
   * 배송사고 주문 생성 (Issue #152)
   * 원본 주문을 복제하여 orderType='claim'인 새 주문 생성
   * @param originalRowNumber - 원본 주문의 행 번호
   * @returns 생성된 주문의 행 번호
   */
  async createClaimOrder(originalRowNumber: number): Promise<number> {
    try {
      // 1. 원본 주문 조회
      const originalOrder = await this._prisma.order.findFirst({
        where: { sheetRowNumber: originalRowNumber, deletedAt: null },
      });

      if (!originalOrder) {
        throw new Error(`Order not found at row ${originalRowNumber}`);
      }

      // 배송완료 상태인지 확인
      if (originalOrder.status !== '배송완료') {
        throw new Error(`Only completed orders can create claim. Current status: ${originalOrder.status}`);
      }

      // 2. 새 행 번호 생성 (가장 큰 행번호 + 1)
      const maxRowResult = await this._prisma.order.aggregate({
        _max: { sheetRowNumber: true },
      });
      const newRowNumber = (maxRowResult._max.sheetRowNumber || 1) + 1;

      // 3. 새 주문 생성 (원본 복제 + orderType='claim')
      const now = new Date();
      // timestampRaw는 한국어 형식으로 생성 (parseKoreanTimestamp 호환)
      const timestampRaw = now.toLocaleString('ko-KR', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: true,
      });

      const newOrder = await this._prisma.order.create({
        data: {
          // 새 식별자
          sheetRowNumber: newRowNumber,
          timestamp: now,
          timestampRaw: timestampRaw,

          // 원본에서 복제 - 주문자 정보
          ordererName: originalOrder.ordererName,
          ordererEmail: originalOrder.ordererEmail,

          // 원본에서 복제 - 발송인/수취인 정보
          senderName: originalOrder.senderName,
          senderPhone: originalOrder.senderPhone,
          senderAddress: originalOrder.senderAddress,
          recipientName: originalOrder.recipientName,
          recipientPhone: originalOrder.recipientPhone,
          recipientAddress: originalOrder.recipientAddress,

          // 원본에서 복제 - 상품 정보
          productSelection: originalOrder.productSelection,
          productType: originalOrder.productType,
          quantity5kg: originalOrder.quantity5kg,
          quantity10kg: originalOrder.quantity10kg,
          quantity: originalOrder.quantity,
          validationError: originalOrder.validationError,

          // 배송사고 설정
          orderType: 'claim',
          status: '신규주문',

          // 메타데이터
          createdAt: now,
          updatedAt: now,
          lastModifiedBy: 'web',
          lastModifiedAt: now,
          version: 1,
        },
      });

      // 4. 변경 로그 기록 (update action 사용, 새 주문 생성 기록)
      await this.changeLogService.logChange({
        orderId: newOrder.id,
        sheetRowNumber: newRowNumber,
        changedBy: 'web',
        action: 'status_change',
        fieldChanges: {
          orderType: { old: null, new: 'claim' },
          originalOrderId: { old: null, new: originalRowNumber },
          status: { old: null, new: '신규주문' },
        },
        previousVersion: 0,
      });

      return newRowNumber;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create claim order: ${message}`);
    }
  }

  /**
   * 연결 종료 (앱 종료 시)
   * 자체 생성한 PrismaClient만 종료
   */
  async disconnect(): Promise<void> {
    if (this.ownsPrisma) {
      await this._prisma.$disconnect();
    }
  }
}
