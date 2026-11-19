/**
 * #231: 시트 재조정은 DATA_SOURCE=hybrid 일 때만 켠다 (S-5 · DB 우선 #281)
 *
 * sheets 모드는 시트가 정본이고 database 모드는 시트를 쓰지 않는다. hybrid 에서 남은 실패 표시가 다른 모드에서
 * 오래된 DB 값으로 시트를 덮지 않게 한다. 값은 api 와 같은 루트 .env 의 DATA_SOURCE(기본 sheets).
 */
import { SheetReconciler, type SheetService, type DatabaseService, type Logger } from '@mytangerine/core';

export function createReconciler(
  dataSource: string | undefined,
  sheetService: SheetService,
  databaseService: DatabaseService,
  logger: Logger
): SheetReconciler | undefined {
  const mode = dataSource ?? 'sheets';
  if (mode !== 'hybrid') {
    logger.info({ dataSource: mode }, 'Sheet reconcile disabled (hybrid only · #231)');
    return undefined;
  }
  logger.info({ dataSource: mode }, 'Sheet reconcile enabled (#231)');
  return new SheetReconciler(sheetService, databaseService, logger);
}
