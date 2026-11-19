/**
 * DatabaseService
 *
 * PostgreSQL 기반 데이터베이스 서비스
 * SheetService와 동일한 인터페이스 제공하여 기존 API와 호환
 *
 * Issue #68 Phase 2.1: Google Sheets → PostgreSQL 하이브리드 시스템
 */

import type { PrismaClient, Prisma } from '@prisma/client';
import { createPrismaClient } from './prisma-client-factory.js';
import { shouldFlagNewOrderNotice, type NewOrderNoticePolicy, type NewOrderNoticeStatus } from './new-order-notice.js';
import type { SheetRow, OrderStatus } from '../types/order.js';
import { parseKoreanTimestamp, validateProductSelection, extractQuantity, normalizeOrderStatus, parseOrderType } from '../types/order.js';
import type { Config } from '../config/config.js';
import { ChangeLogService, type FieldChange } from './change-log-service.js';
import { normalizeTimestampRaw } from './sheet-row-identity.js';
import { buildOriginalInput, type OriginalInput } from './original-input.js';
import { diffSheetFirstOverwrite } from './sheet-first-diff.js';

/**
 * #266: findOrderAtOtherRow 후보 창 — 해석한 시각 기준 ±27시간.
 * 옛 주문이 다른 프로세스 시간대로 해석됐을 수 있다(UTC-12 ~ UTC+14 → 최대 26시간 차이)
 */
const FIND_OTHER_ROW_WINDOW_MS = 27 * 60 * 60 * 1000;

/**
 * 쓰기 트랜잭션 옵션 (#197) — 변경 전 조회 · 업데이트 · 변경 이력을 한 트랜잭션으로.
 * 이력이 많은 쓰기를 위해 기본(5초)보다 넉넉히 두되, 대기+실행(25초)이 웹 서버·클라이언트
 * 타임아웃(30초)보다 짧아야 한다 — 클라이언트는 타임아웃인데 서버는 커밋하는 경우를 피한다.
 */
const WRITE_TX_OPTIONS = { maxWait: 5_000, timeout: 20_000 } as const;

/** syncErrorMessage 최대 길이 */
const MAX_SYNC_ERROR_LENGTH = 1000;

/**
 * 시트 행이 있는 주문인가 (#234). 배송사고(claim) 주문은 sheetRowNumber 가 null 이고,
 * order_change_logs.sheet_row_number 는 NOT NULL 이라 그 주문의 이력은 남기지 않는다(markDeliveredById 와 같은 관례).
 * 행 번호로 조회하는 경로(sheetRowNumber in rowNumbers)에서는 실제로 null 이 오지 않는다 — 타입 좁히기 · 방어용.
 */
function hasSheetRow<T extends { sheetRowNumber: number | null }>(order: T): order is T & { sheetRowNumber: number } {
  return order.sheetRowNumber !== null;
}

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
      this._prisma = createPrismaClient();
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
      // Issue #155: 배송사고 원본 주문 참조
      _originalRowNumber: order.originalRowNumber || undefined,
      // Issue #155: 주문유형 (영문, 내부 필터링용)
      _orderType: (order.orderType as 'customer' | 'gift' | 'claim') || 'customer',
      // Issue #165: DB ID (claim 주문 식별용)
      _dbId: order.id,
      // #281: 최초 입력값 (이 기능 이전 주문은 null → 없음)
      _originalInput: (order.originalInput as Record<string, string> | null) ?? undefined,
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
   * Issue #155: DB ID로 주문 조회 (claim 주문 등 sheetRowNumber가 null인 경우)
   */
  async getOrderById(id: number): Promise<SheetRow | null> {
    try {
      const order = await this._prisma.order.findUnique({
        where: { id },
      });

      if (!order) {
        return null;
      }

      return this.prismaOrderToSheetRow(order);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get order by id ${id}: ${message}`);
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
   * @param rowNumbers - 처리할 행 번호 배열. **비었거나 없으면 아무것도 하지 않는다** (#234 — 예전에는
   *   "배송완료가 아닌 주문 전부"(입금확인 포함)를 바꿨다. 시트 쪽은 같은 입력에서 아무것도 하지 않는다)
   * @param changedBy - 변경 주체
   */
  async markAsConfirmed(rowNumbers?: number[], changedBy: 'web' | 'sync' | 'api' = 'api'): Promise<void> {
    if (!rowNumbers || rowNumbers.length === 0) return;
    try {
      return await this._prisma.$transaction(async (db: Prisma.TransactionClient) => {
        // 변경 전 주문 조회 (이력 기록용)
        const beforeOrders = await db.order.findMany({
          where: { sheetRowNumber: { in: rowNumbers }, deletedAt: null },
        });

        await db.order.updateMany({
          where: {
            sheetRowNumber: { in: rowNumbers },
            deletedAt: null, // Soft Delete된 주문 제외
          },
          data: {
            status: '배송완료',
            updatedAt: new Date(),
          },
        });

        // 각 주문에 대해 이력 기록
        for (const order of beforeOrders) {
          if (order.status !== '배송완료' && hasSheetRow(order)) {
            await this.changeLogService.logChange({
              orderId: order.id,
              sheetRowNumber: order.sheetRowNumber,
              changedBy,
              action: 'status_change',
              fieldChanges: {
                status: { old: order.status, new: '배송완료' },
              },
              previousVersion: order.version ?? 1,
            }, db);
          }
        }
      }, WRITE_TX_OPTIONS);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const context = `rows ${rowNumbers.join(', ')}`;
      throw new Error(`Failed to mark as delivered (${context}): ${message}`);
    }
  }

  /**
   * 시트 반영 실패 기록 (#197) — hybrid 쓰기에서 DB 는 성공했는데 시트가 실패한 행.
   * 주문 데이터·version·변경 이력은 건드리지 않는다.
   */
  async markSheetSyncFailed(rowNumbers: number[], reason: string): Promise<void> {
    if (rowNumbers.length === 0) return;
    await this._prisma.order.updateMany({
      where: { sheetRowNumber: { in: rowNumbers } },
      data: { syncStatus: 'failed', syncErrorMessage: reason.slice(0, MAX_SYNC_ERROR_LENGTH) },
    });
  }

  /**
   * #231 재조정 대상 — 시트 반영 실패 표시가 있고 시트 행이 있는 주문, 오래된 것부터.
   * (DB 전용 claim 은 시트 행이 없어 대상이 아니다)
   */
  async getSheetSyncFailedOrders(limit: number, excludeIds: readonly number[] = []): Promise<PrismaOrder[]> {
    return this._prisma.order.findMany({
      where: {
        syncStatus: 'failed',
        sheetRowNumber: { not: null },
        // 재조정기가 미뤄 둔(백오프) 주문은 빼고 읽는다 — 막힌 주문이 앞자리를 차지해 뒤 주문을 가리지 않게
        ...(excludeIds.length > 0 ? { id: { notIn: [...excludeIds] } } : {}),
      },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
  }

  /**
   * 시트 반영 실패 표시 해제 (#197 · #231) — 행 전체를 시트에 다시 맞춘 뒤에만 쓴다.
   * 일부 필드만 쓰는 일반 hybrid 쓰기의 성공으로는 지우지 않는다(PR #230 Codex P2).
   * **읽은 뒤 주문이 바뀌지 않았을 때(updatedAt 같음)만** 지운다 — 그 사이 웹 수정이 있었으면 시트가 낡았을 수 있다.
   * @returns 지운 건수(0 = 바뀌었거나 이미 지워짐)
   */
  async clearSheetSyncFailureIfUnchanged(orderId: number, readUpdatedAt: Date): Promise<number> {
    const { count } = await this._prisma.order.updateMany({
      where: { id: orderId, syncStatus: 'failed', updatedAt: readUpdatedAt },
      data: { syncStatus: 'success', syncErrorMessage: null, syncedAt: new Date() },
    });
    return count;
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
      return await this._prisma.$transaction(async (db: Prisma.TransactionClient) => {
        // 변경 전 주문 조회
        const beforeOrder = await db.order.findFirst({
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
        await db.order.updateMany({
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
        }, db);
      }, WRITE_TX_OPTIONS);
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
      return await this._prisma.$transaction(async (db: Prisma.TransactionClient) => {
        // 변경 전 주문 조회 (이력 기록용)
        const beforeOrders = await db.order.findMany({
          where: {
            sheetRowNumber: { in: rowNumbers },
            deletedAt: null,
          },
        });

        await db.order.updateMany({
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
          if (order.status !== '입금확인' && hasSheetRow(order)) {
            await this.changeLogService.logChange({
              orderId: order.id,
              sheetRowNumber: order.sheetRowNumber,
              changedBy,
              action: 'status_change',
              fieldChanges: {
                status: { old: order.status, new: '입금확인' },
              },
              previousVersion: order.version ?? 1,
            }, db);
          }
        }
      }, WRITE_TX_OPTIONS);
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
      return await this._prisma.$transaction(async (db: Prisma.TransactionClient) => {
        // 변경 전 주문 조회 (이력 기록용)
        const beforeOrders = await db.order.findMany({
          where: {
            sheetRowNumber: { in: rowNumbers },
            deletedAt: null,
          },
        });

        await db.order.updateMany({
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

          if (Object.keys(fieldChanges).length > 0 && hasSheetRow(order)) {
            await this.changeLogService.logChange({
              orderId: order.id,
              sheetRowNumber: order.sheetRowNumber,
              changedBy,
              action: 'status_change',
              fieldChanges,
              previousVersion: order.version ?? 1,
            }, db);
          }
        }
      }, WRITE_TX_OPTIONS);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to mark as delivered (rows: ${rowNumbers.join(', ')}): ${message}`);
    }
  }

  /**
   * 배송완료 처리 - DB ID 기반 (Issue #168: claim 주문용)
   * @param dbId - DB ID
   * @param trackingNumber - 송장번호 (선택)
   * @param changedBy - 변경 주체
   */
  async markDeliveredById(dbId: number, trackingNumber?: string, changedBy: 'web' | 'sync' | 'api' = 'api'): Promise<void> {
    try {
      return await this._prisma.$transaction(async (db: Prisma.TransactionClient) => {
        // 변경 전 주문 조회 (이력 기록용)
        const order = await db.order.findUnique({
          where: { id: dbId },
        });

        if (!order) {
          throw new Error(`Order not found with id: ${dbId}`);
        }

        if (order.deletedAt) {
          throw new Error(`Cannot update deleted order with id: ${dbId}`);
        }

        await db.order.update({
          where: { id: dbId },
          data: {
            status: '배송완료',
            ...(trackingNumber && { trackingNumber }),
            updatedAt: new Date(),
          },
        });

        // 이력 기록 (claim 주문은 sheetRowNumber가 null이므로 change log 스킵)
        // P2 리뷰 반영: claim 주문은 sheetRowNumber가 null이라 원본 주문의 sheetRowNumber로 기록하면
        // 원본 주문의 히스토리에 claim 변경사항이 표시되어 혼란을 줌
        if (order.sheetRowNumber !== null) {
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
            }, db);
          }
        }
      }, WRITE_TX_OPTIONS);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to mark as delivered (id: ${dbId}): ${message}`);
    }
  }

  /**
   * Soft Delete (Phase 3)
   * @param rowNumbers - 삭제할 행 번호 배열
   * @param changedBy - 변경 주체
   */
  async softDelete(rowNumbers: number[], changedBy: 'web' | 'sync' | 'api' = 'api'): Promise<void> {
    try {
      return await this._prisma.$transaction(async (db: Prisma.TransactionClient) => {
        // 변경 전 주문 조회 (이력 기록용)
        const beforeOrders = await db.order.findMany({
          where: {
            sheetRowNumber: { in: rowNumbers },
            deletedAt: null,
          },
        });

        const deletedAt = new Date();

        await db.order.updateMany({
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
          if (!hasSheetRow(order)) continue;
          await this.changeLogService.logChange({
            orderId: order.id,
            sheetRowNumber: order.sheetRowNumber,
            changedBy,
            action: 'delete',
            fieldChanges: {
              deletedAt: { old: null, new: deletedAt.toISOString() },
            },
            previousVersion: order.version ?? 1,
          }, db);
        }
      }, WRITE_TX_OPTIONS);
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
      return await this._prisma.$transaction(async (db: Prisma.TransactionClient) => {
        // 변경 전 주문 조회 (이력 기록용)
        const beforeOrders = await db.order.findMany({
          where: {
            sheetRowNumber: { in: rowNumbers },
            deletedAt: { not: null },
          },
        });

        await db.order.updateMany({
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
          if (!hasSheetRow(order)) continue;
          await this.changeLogService.logChange({
            orderId: order.id,
            sheetRowNumber: order.sheetRowNumber,
            changedBy,
            action: 'restore',
            fieldChanges: {
              deletedAt: { old: order.deletedAt?.toISOString() ?? null, new: null },
            },
            previousVersion: order.version ?? 1,
          }, db);
        }
      }, WRITE_TX_OPTIONS);
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
      return await this._prisma.$transaction(async (db: Prisma.TransactionClient) => {
        // 컬럼명 매핑 (한글 → DB 필드)
        const columnMap: Record<string, string> = {
          '비고': 'status',
          'DB_SYNC_STATUS': 'syncStatus',
          'DB_SYNC_AT': 'syncedAt',
          'DB_SYNC_ID': 'id',
        };

        const dbField = columnMap[columnName] || columnName;

        // 동적 업데이트 (타입 안전성 제한적)
        await db.order.updateMany({
          where: { sheetRowNumber: rowNumber },
          data: {
            [dbField]: value,
            updatedAt: new Date(),
          } as any,
        });
      }, WRITE_TX_OPTIONS);
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
  async upsertOrder(
    row: SheetRow,
    syncMeta?: {
      syncStatus: 'pending' | 'success' | 'failed';
      syncAttemptCount?: number;
      syncErrorMessage?: string;
    },
    options?: {
      /** #251: 있으면 새로 만드는 주문에만 알림 대기 표시(create 쪽만 — 기존 주문은 건드리지 않는다) */
      newOrderNotice?: NewOrderNoticePolicy;
    }
  ): Promise<PrismaOrder> {
    try {
      const data = this.sheetRowToPrismaOrderData(row);

      // syncMeta가 제공되면 사용, 아니면 기본값
      const syncData = syncMeta || {
        syncStatus: 'success',
        syncAttemptCount: 1,
        syncedAt: new Date(),
      };

      const updateData = this.buildSyncUpdateData(data, syncData);

      const result = await this._prisma.order.upsert({
        where: { sheetRowNumber: data.sheetRowNumber },
        // #281: 최초 입력값은 만들 때만 — update(시트 우선 가져오기)는 바꾸지 않는다
        create: this.buildSyncCreateData(data, syncData, options, buildOriginalInput(row)),
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
   * 동기화가 기존 주문을 시트 값으로 덮어쓸 때의 update 데이터 — 최초 입력값(#281)은 넣지 않는다
   * P1 Fix: deletedAt 처리
   * - undefined: 시트에 '삭제됨' 컬럼 없음 → update에서 제외 (기존 DB 값 유지)
   * - null: 시트에서 명시적 빈값 → update에 포함 (복원)
   * - Date: 삭제 날짜 → update에 포함 (soft delete)
   */
  private buildSyncUpdateData(
    data: ReturnType<DatabaseService['sheetRowToPrismaOrderData']>,
    syncData: Record<string, unknown>
  ) {
    const { deletedAt, ...dataWithoutDeletedAt } = data;
    return {
      ...dataWithoutDeletedAt,
      ...(deletedAt === undefined ? {} : { deletedAt }),
      ...syncData,
      syncedAt: new Date(),
    };
  }

  /**
   * #281 시트 우선 가져오기(운영자 복구): 기존 주문을 시트 값으로 덮어쓰고 바뀐 필드 전체를 변경 이력에 남긴다 — 한 트랜잭션.
   * 동기화가 주문을 읽은 뒤 웹 수정으로 version 이 바뀌었으면 쓰지 않고 던진다(그 수정을 덮지 않는다).
   * 최초 입력값(original_input)은 바꾸지 않는다.
   */
  async overwriteOrderFromSheet(
    existing: { id: number; version: number | null },
    row: SheetRow,
    syncMeta: { syncStatus: 'pending' | 'success' | 'failed'; syncAttemptCount?: number }
  ): Promise<{ order: PrismaOrder; fieldChanges: Record<string, FieldChange> }> {
    const data = this.sheetRowToPrismaOrderData(row);
    const updateData = this.buildSyncUpdateData(data, syncMeta);
    const expectedVersion = existing.version ?? 1;

    try {
      return await this._prisma.$transaction(async (db: Prisma.TransactionClient) => {
        const current = await db.order.findUnique({ where: { id: existing.id } });
        if (!current) {
          throw new Error(`order #${existing.id} no longer exists`);
        }
        if ((current.version ?? 1) !== expectedVersion) {
          throw new Error(
            `order #${existing.id} changed concurrently (version ${expectedVersion} → ${current.version}) — not overwritten`
          );
        }

        const fieldChanges = diffSheetFirstOverwrite(
          updateData as Record<string, unknown>,
          current as unknown as Record<string, unknown>
        );
        // 확인한 version 을 조건으로 건다 — 확인과 쓰기 사이에 커밋된 웹 수정도 덮지 않는다
        const { count } = await db.order.updateMany({
          where: { id: existing.id, version: expectedVersion },
          data: updateData,
        });
        if (count === 0) {
          throw new Error(`order #${existing.id} changed concurrently while overwriting — not overwritten`);
        }
        const order = await db.order.findUniqueOrThrow({ where: { id: existing.id } });

        if (Object.keys(fieldChanges).length > 0) {
          await this.changeLogService.logChange(
            {
              orderId: existing.id,
              sheetRowNumber: data.sheetRowNumber,
              changedBy: 'sync',
              action: 'update',
              fieldChanges,
              previousVersion: expectedVersion,
            },
            db
          );
        }
        return { order, fieldChanges };
      }, WRITE_TX_OPTIONS);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to overwrite order from sheet (row: ${data.sheetRowNumber}): ${message}`);
    }
  }

  /**
   * 동기화로 새 주문을 만들 때의 create 데이터 — upsert · 행 재사용 교체가 같이 쓴다
   * #251: 정책이 있으면(cron) 알림 대기 표시
   */
  private buildSyncCreateData(
    data: ReturnType<DatabaseService['sheetRowToPrismaOrderData']>,
    syncData: Record<string, unknown>,
    options: { newOrderNotice?: NewOrderNoticePolicy } | undefined,
    originalInput: OriginalInput
  ) {
    return {
      ...data,
      ...syncData,
      syncedAt: new Date(),
      // #281: 주문자가 처음 입력한 값 — 이후 바꾸지 않는다
      originalInput,
      ...(shouldFlagNewOrderNotice(data, options?.newOrderNotice) ? { newOrderNotice: 'pending' } : {}),
    };
  }

  /**
   * #258: 행 번호들의 DB 주문 시각 — hybrid 쓰기 전 시트 행 확인용
   */
  async getOrderTimestampsByRows(
    rowNumbers: number[]
  ): Promise<Map<number, { timestamp: Date; timestampRaw: string | null }>> {
    const orders = await this._prisma.order.findMany({
      where: { sheetRowNumber: { in: rowNumbers } },
      select: { sheetRowNumber: true, timestamp: true, timestampRaw: true },
    });
    return new Map(
      orders.filter(hasSheetRow).map((o) => [o.sheetRowNumber, { timestamp: o.timestamp, timestampRaw: o.timestampRaw }])
    );
  }

  /**
   * #257: 이 시트 행의 주문(원문 · 정규화 원문 · 해석한 시각 중 하나가 같은 주문)이 DB 의 **다른** 행 번호에 있는지.
   * 시트 행이 밀린 경우를 가린다. 원문 비교가 시간대와 무관하고, 정규화 원문은 표시 형식 차이를(#266),
   * 시각 비교는 원문 형식이 달라 정규화로도 맞지 않는 옛 행을 덮는다. 여럿이면 id 가 가장 작은 주문.
   * 시트 원문을 시각으로 해석하지 못하면 후보 창을 만들 수 없어 원문 정확 일치만 본다.
   */
  async findOrderAtOtherRow(
    timestampRaw: string,
    timestamp: Date | null,
    excludeRowNumber: number
  ): Promise<number | null> {
    // `not: N` 은 SQL `<> N` 이라 시트 행이 없는(NULL) 주문 — DB 전용 배송사고 — 도 함께 빠진다.
    // #266: isSameOrder · 시트 색인과 같은 기준(정규화 원문)으로 본다. 다른 시간대로 해석돼 시각이 어긋나고
    // 표시 형식만 다른 옛 주문은 원문 = 도 시각 = 도 실패하므로, 해석한 시각 ±FIND_OTHER_ROW_WINDOW_MS 의 후보를 읽어 앱에서 비교한다
    const key = normalizeTimestampRaw(timestampRaw);
    const candidates = await this._prisma.order.findMany({
      where: {
        sheetRowNumber: { not: excludeRowNumber },
        OR: [
          { timestampRaw },
          ...(timestamp
            ? [
                {
                  timestamp: {
                    gte: new Date(timestamp.getTime() - FIND_OTHER_ROW_WINDOW_MS),
                    lte: new Date(timestamp.getTime() + FIND_OTHER_ROW_WINDOW_MS),
                  },
                },
              ]
            : []),
        ],
      },
      select: { id: true, timestampRaw: true, timestamp: true },
      orderBy: { id: 'asc' },
    });
    const found = candidates.find(
      (c) =>
        c.timestampRaw === timestampRaw ||
        (key !== '' && normalizeTimestampRaw(c.timestampRaw) === key) ||
        (timestamp !== null && c.timestamp.getTime() === timestamp.getTime())
    );
    return found?.id ?? null;
  }

  /**
   * #257: 최근 동기화가 "행 재사용 교체"를 몇 번 했는지 — 차단기가 실행을 넘어 누적으로 판단하게
   */
  async countRecentRowReplacements(since: Date): Promise<number> {
    return this._prisma.orderChangeLog.count({
      where: {
        changedBy: 'sync',
        action: 'delete',
        changedAt: { gte: since },
        fieldChanges: { path: ['reason', 'new'], equals: 'sheet_row_reused' },
      },
    });
  }

  /**
   * #257: 시트 행 번호가 다른 주문에 재사용됐을 때 — 한 트랜잭션으로
   * 1) 예전 주문을 시트 행에서 분리(sheetRowNumber=null)하고 삭제 처리(이미 삭제됐으면 그 시각 유지) — 레코드·이력은 보존
   * 2) 변경 이력(sync · delete · 사유 sheet_row_reused)
   * 3) 그 행의 새 주문 create (cron 이면 알림 대기 표시)
   * 어느 단계든 실패하면 전부 롤백된다.
   */
  async replaceOrderAtRow(
    existing: { id: number; version: number | null; deletedAt: Date | null },
    row: SheetRow,
    syncMeta: { syncStatus: 'pending' | 'success' | 'failed'; syncAttemptCount?: number },
    options?: { newOrderNotice?: NewOrderNoticePolicy }
  ): Promise<PrismaOrder> {
    const data = this.sheetRowToPrismaOrderData(row);
    const rowNumber = data.sheetRowNumber;
    const deletedAt = existing.deletedAt ?? new Date();

    try {
      return await this.replaceOrderAtRowTx(existing, data, rowNumber, deletedAt, syncMeta, options, buildOriginalInput(row));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to replace order at reused row (row: ${rowNumber}, old #${existing.id}): ${message}`);
    }
  }

  private replaceOrderAtRowTx(
    existing: { id: number; version: number | null; deletedAt: Date | null },
    data: ReturnType<DatabaseService['sheetRowToPrismaOrderData']>,
    rowNumber: number,
    deletedAt: Date,
    syncMeta: Record<string, unknown>,
    options: { newOrderNotice?: NewOrderNoticePolicy } | undefined,
    originalInput: OriginalInput
  ): Promise<PrismaOrder> {
    return this._prisma.$transaction(async (db: Prisma.TransactionClient) => {
      await db.order.update({
        where: { id: existing.id },
        data: { sheetRowNumber: null, deletedAt },
      });

      await this.changeLogService.logChange(
        {
          orderId: existing.id,
          sheetRowNumber: rowNumber,
          changedBy: 'sync',
          action: 'delete',
          fieldChanges: {
            sheetRowNumber: { old: rowNumber, new: null },
            ...(existing.deletedAt ? {} : { deletedAt: { old: null, new: deletedAt.toISOString() } }),
            reason: { old: null, new: 'sheet_row_reused' },
          },
          previousVersion: existing.version ?? 1,
        },
        db
      );

      return db.order.create({ data: this.buildSyncCreateData(data, syncMeta, options, originalInput) });
    }, WRITE_TX_OPTIONS);
  }

  /**
   * #251: 알림 대기 주문 — pending · 삭제 안 됨 · 시트 행 있음 · 오래된 것부터
   */
  async getPendingNewOrderNotices(
    limit: number
  ): Promise<Array<{ id: number; sheetRowNumber: number; timestamp: Date }>> {
    const rows = await this._prisma.order.findMany({
      where: { newOrderNotice: 'pending', deletedAt: null, sheetRowNumber: { not: null } },
      select: { id: true, sheetRowNumber: true, timestamp: true },
      orderBy: { id: 'asc' },
      take: limit,
    });
    return rows.filter(hasSheetRow);
  }

  /**
   * #251: 알림 결과 기록 — pending 일 때만 바꾼다(두 번 기록되지 않게). 바꿨으면 true
   */
  async setNewOrderNoticeResult(
    id: number,
    status: Exclude<NewOrderNoticeStatus, 'pending'>,
    at: Date = new Date()
  ): Promise<boolean> {
    const { count } = await this._prisma.order.updateMany({
      where: { id, newOrderNotice: 'pending' },
      data: { newOrderNotice: status, newOrderNoticeAt: at },
    });
    return count > 0;
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
      return await this._prisma.$transaction(async (db: Prisma.TransactionClient) => {
        // 1. 변경 전 주문 조회
        const beforeOrder = await db.order.findFirst({
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
          // P2 Fix: derived quantity 필드도 함께 업데이트 (claim 주문 복제 등에서 사용)
          data.quantity = updates.quantity;
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
        await db.order.updateMany({
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
          }, db);
        }
      }, WRITE_TX_OPTIONS);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to update order (row: ${rowNumber}): ${message}`);
    }
  }

  /**
   * 배송사고 주문 생성 (Issue #152, #155)
   * 원본 주문을 복제하여 orderType='claim'인 새 주문 생성
   *
   * Issue #155: 배송사고는 DB에만 저장 (Sheets에 저장하지 않음)
   * - sheetRowNumber: null (Sheets 행 번호 충돌 방지)
   * - originalRowNumber: 원본 주문의 sheetRowNumber (추적용)
   *
   * @param originalRowNumber - 원본 주문의 행 번호
   * @returns 생성된 주문의 DB id
   */
  async createClaimOrder(originalRowNumber: number): Promise<number> {
    try {
      return await this._prisma.$transaction(async (db: Prisma.TransactionClient) => {
        // 1. 원본 주문 조회
        const originalOrder = await db.order.findFirst({
          where: { sheetRowNumber: originalRowNumber, deletedAt: null },
        });

        if (!originalOrder) {
          throw new Error(`Order not found at row ${originalRowNumber}`);
        }

        // 배송완료 상태인지 확인 (레거시 '확인' 상태도 배송완료로 처리)
        const normalizedStatus = normalizeOrderStatus(originalOrder.status);
        if (normalizedStatus !== '배송완료') {
          throw new Error(`Only completed orders can create claim. Current status: ${originalOrder.status}`);
        }

        // 2. 새 주문 생성 (원본 복제 + orderType='claim')
        // Issue #155: sheetRowNumber는 null, originalRowNumber에 원본 참조 저장
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

        const newOrder = await db.order.create({
          data: {
            // Issue #155: sheetRowNumber는 null (Sheets에 저장 안 함)
            sheetRowNumber: null,
            // Issue #155: 원본 주문 참조
            originalRowNumber: originalRowNumber,

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
            // Issue #168: claim 주문은 결제 없이 발송해야 하므로 '입금확인' 상태로 생성
            status: '입금확인',

            // Issue #165: claim 주문은 DB 전용이므로 syncStatus를 'success'로 설정
            // (시트에 동기화하지 않으므로 이미 동기화 완료 상태로 간주)
            syncStatus: 'success',

            // 메타데이터
            createdAt: now,
            updatedAt: now,
            lastModifiedBy: 'web',
            lastModifiedAt: now,
            version: 1,
          },
        });

        // P2 리뷰 반영: claim 주문은 change log 생성 스킵
        // - claim 주문은 sheetRowNumber가 null이라 원본 주문의 sheetRowNumber로 기록하면
        //   원본 주문의 히스토리에 claim 변경사항이 표시되어 혼란을 줌
        // - claim 주문은 UI에서 변경 이력을 표시하지 않으므로 로그 생성 불필요

        // Issue #155: DB id 반환 (sheetRowNumber가 null이므로)
        return newOrder.id;
      }, WRITE_TX_OPTIONS);
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
