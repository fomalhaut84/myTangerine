/**
 * @mytangerine/core
 * myTangerine 핵심 비즈니스 로직
 */

// Types
export * from './types/order.js';
export * from './types/pdf.js';
export * from './types/excel.js';

// Config
export { Config } from './config/config.js';
export type { Env } from './config/env.js';
export { findProjectRoot } from './utils/find-root.js';

// Services
export { SheetService } from './services/sheet-service.js';
export { DatabaseService } from './services/database-service.js';
export {
  createPrismaClient,
  DB_CONNECT_TIMEOUT_MS,
  type CreatePrismaClientOptions,
} from './services/prisma-client-factory.js';
export {
  HybridDataService,
  type DataSourceMode,
  type HybridDataServiceOptions,
} from './services/hybrid-data-service.js';
export {
  HybridWriteError,
  SheetRowMismatchError,
  SHEET_SYNC_WARNING,
  type WriteOutcome,
} from './services/hybrid-write.js';
export {
  SyncEngine,
  RowIdentityConflictError,
  RowReplacementLimitError,
  type SyncResult,
  type SyncEngineOptions,
  type Logger,
} from './services/sync-engine.js';
export {
  shouldFlagNewOrderNotice,
  isWithinNoticeWindow,
  NEW_ORDER_NOTICE_WINDOW_MS,
  type NewOrderNoticePolicy,
  type NewOrderNoticeStatus,
} from './services/new-order-notice.js';
export {
  DistributedLockService,
  withDistributedLock,
  type DistributedLockOptions,
} from './services/distributed-lock.js';
export {
  ChangeLogService,
  type FieldChange,
  type LogChangeParams,
  type GetChangeLogsOptions,
  type GetConflictsOptions,
} from './services/change-log-service.js';

// Formatters
export { LabelFormatter } from './formatters/label-formatter.js';
export { mapOrderToPdfRow, mapOrdersToPdfRows } from './formatters/pdf-formatter.js';
export { mapOrderToExcelRow, mapOrdersToExcelRows } from './formatters/excel-formatter.js';

// Utils (추후 추가)
// export * from './utils/phone.js';
// export * from './utils/quantity.js';
// export * from './utils/timestamp.js';
