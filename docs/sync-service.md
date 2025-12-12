# Sync Service

## 1. 개요
- **목적:** Google Sheets 주문 데이터를 PostgreSQL에 자동 반영하는 단방향 동기화 서비스입니다. Phase 2.1의 핵심 백엔드 구성 요소로, 신뢰성 있는 주문 데이터 파이프라인을 책임집니다.
- **아키텍처 위치:** `@mytangerine/sync-service` 패키지는 core 패키지(`@mytangerine/core`)가 노출하는 Sheets/DB 서비스 위에서 실행되며 node-cron 스케줄러를 사용해 분 단위 작업을 트리거합니다. 서비스는 독립 실행형 프로세스로 구동되며 Graceful shutdown을 통해 마지막 싱크 완료를 보장합니다.

## 2. 아키텍처
```text
┌─────────────────────────────────────────────────────────┐
│                    Sync Service Runtime                │
│                                                         │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐ │
│  │ Config & ENV │→→│ PollingScheduler│→→│ SyncEngine │ │
│  └──────────────┘   └──────────────┘   └──────────────┘ │
│          │                      │             │          │
│  ┌──────────────┐         ┌──────────────┐ ┌────────────┐│
│  │ Logger       │←────────│ SheetService │ │DatabaseSvc ││
│  └──────────────┘         └──────────────┘ └────────────┘│
└─────────────────────────────────────────────────────────┘
```
- **컴포넌트 흐름:**
  1. `src/index.ts`에서 환경 변수 로딩 및 core 서비스(SheetService, DatabaseService) 인스턴스화.
  2. `PollingScheduler`가 `SYNC_INTERVAL` 크론 표현식을 검증 후 1분 간격으로 `SyncEngine.incrementalSync()` 호출.
  3. `SyncEngine`은 Sheets에서 행을 읽고, 증분 대상만 선별해 DatabaseService로 upsert.
  4. 각 행의 결과는 다시 Sheet에 기록되며 `logger`가 메트릭을 남깁니다.
- **데이터 흐름:** Google Sheets → SyncEngine(검증/증분 판단) → PostgreSQL → Sheets(상태 업데이트). 실패한 행은 다음 폴링 주기에 자동 재시도됩니다.

## 3. 핵심 기능
- **증분 싱크 (`incrementalSync`)**
  - `DB_SYNC_STATUS` 필드가 없는 행만 처리하여 API 호출 수를 최소화합니다.
  - 처리 순서는 Sheets 정렬 순서를 따르며 `SyncResult`로 성공/실패/스킵 수치를 반환합니다.
- **전체 재싱크 (`fullResync`)**
  - 운영 중 데이터 불일치가 의심될 때 수동 호출합니다.
  - 모든 행을 강제로 upsert하고 상태 필드를 최신화합니다. 장시간 실행 가능성을 고려해 모니터링이 필요합니다.
- **에러 핸들링**
  - 개별 행 실패는 `errors` 배열에 기록하고 전체 배치를 중단하지 않습니다.
  - DatabaseService upsert 성공 후 Sheets 업데이트가 실패할 수 있으므로 각각 별도 try/catch로 감쌉니다.
  - 싱크 종료 시 `total/success/failed/skipped`를 로깅해 관측성을 확보합니다.

## 4. 설치 및 설정
1. 루트에서 의존성 설치: `pnpm install`
2. `.env` (또는 `packages/sync-service/.env`)에 아래 환경 변수 설정:
   ```env
   SYNC_INTERVAL="*/1 * * * *"
   SYNC_ENABLED="true"
   LOG_LEVEL="info"
   DATABASE_URL="postgresql://user:password@localhost:5432/mytangerine?schema=public"
   ```
3. Google Sheets API 자격 증명(`credentials.json`)을 core 패키지 요구 형태로 배치합니다.
4. PostgreSQL 인스턴스가 기동 중이며 `@mytangerine/core`가 접근 가능해야 합니다.

## 5. 실행 방법
- **개발 모드**
  ```bash
  pnpm --filter @mytangerine/sync-service dev
  ```
- **프로덕션 빌드 & 실행**
  ```bash
  pnpm --filter @mytangerine/sync-service build
  pnpm --filter @mytangerine/sync-service start
  ```
- Graceful shutdown: SIGINT/SIGTERM 수신 시 현재 배치 완료 후 종료합니다. 컨테이너/PM2 등에서 stop 신호를 줄 때 최소 1분 이상의 타임아웃을 확보하세요.

## 6. 모니터링 및 로그
- `src/utils/logger.ts`는 `pino` 기반이며 개발 모드에서는 `pino-pretty`로 컬러 출력합니다.
- `LOG_LEVEL`로 `debug|info|warn|error` 지정 가능하며 운영에서는 `info` 또는 `warn`을 권장합니다.
- 주요 로그 항목:
  - 스케줄러 시작/중지 및 현재 크론 표현식
  - 싱크 실행 시간과 result 메트릭(total/success/failed/skipped)
  - 개별 행 실패 시 row identifier 및 오류 메시지
- 로그 수집기는 stdout을 우선 수집하고 필요 시 `pino` transport로 ELK/Cloud Logging에 연동합니다.

## 7. 트러블슈팅
- **싱크가 실행되지 않음:** `SYNC_ENABLED`가 `true`인지 확인하고 크론 표현식 검증 실패 로그를 확인합니다.
- **동시 실행 경고:** 이전 싱크가 장시간 실행 중일 수 있습니다. `isRunning`이 true면 새 사이클은 대기하므로 지연 원인(대량 데이터, DB 슬로우 쿼리)을 조사하세요.
- **Sheets API quota 초과:** `incrementalSync`가 정상적으로 스킵을 수행하는지 점검하고, 필요 시 `SYNC_INTERVAL`을 늘리거나 `fullResync` 빈도를 조절합니다.
- **DB 업서트 성공 후 Sheets 업데이트 실패:** `errors` 배열과 관련 로그를 확인해 수동 재시도하거나 `fullResync`를 실행합니다.
- **Graceful shutdown 미동작:** 프로세스가 강제 종료된 경우 마지막 배치가 중단될 수 있으니 프로세스 매니저에서 SIGTERM 후 충분한 대기 시간을 구성합니다.

## 8. 향후 개선사항
- Sheets API rate-limit 대응을 위한 paging 및 백오프 전략
- 싱크 결과 메트릭을 Prometheus/StatsD로 내보내어 대시보드 구축
- 실패 행 자동 재시도 큐(예: BullMQ) 도입
- `fullResync` 진행 상황을 노출하는 관리용 CLI/REST 엔드포인트 추가
- 멀티 인스턴스 환경 대비를 위한 Redis 기반 분산 락 적용
