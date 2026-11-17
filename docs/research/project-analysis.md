# myTangerine 프로젝트 분석 — 2026-11-17

기준: `dev` @ `5a684a1` (v1.1.0 이후 · claim 발송 처리 #169 포함). 읽기 전용 분석 + 로컬 검증 실행.
근거는 `파일:줄`. 확인하지 못한 것은 **미확인**으로 표시했다.

## 요약

- **실체**: pnpm TypeScript 모노레포(`core` · `api` · `web` · `sync-service`). 구글 폼 → 시트 "감귤 주문서(응답)" → PostgreSQL(Prisma) 동기화 + Fastify API + Next.js 16 관리 화면. Python 코드(`src/*.py` · `getLabel.py`)는 TS 쪽에서 참조하지 않는 **죽은 코드**다.
- **가장 큰 위험 3개**
  1. **API 인증 부재** — 주문 수정·상태 변경·삭제·PDF/Excel(개인정보 전체) 등 `orders`·`labels` 라우트 전부가 인증 없이 열려 있고 CORS 기본값이 `*`. `requireApiKey` 는 `/api/sync/*` 3개에만 있다(`packages/api/src/routes/sync.ts:42,190,319` · `config.ts:29`).
  2. **시트↔DB 조용한 불일치** — hybrid 쓰기는 한쪽 실패를 로그만 남기고 삼킨다(`hybrid-data-service.ts` 9곳 `errors.length === 2`). `$transaction` 0건, `version` 낙관적 잠금은 조건 없이 +1. 증분 동기화는 `DB_SYNC_STATUS==='success'` 행을 다시 보지 않는다(`sync-engine.ts:341`).
  3. **Prisma 이원화** — 마이그레이션 이력이 루트 7 · core 6으로 갈라졌고 core 쪽에 `order_type`·`change_log` 가 없다. client 생성 경로도 갈려 core 타입체크가 실패한다.
- **검증 상태**: 테스트는 전부 통과(core 86 · api 74 · web 16)하지만 **타입체크·lint 는 깨져 있다**. CI 는 core·api 의 build/test 만 돌고 lint 는 `continue-on-error` 라 이것을 못 잡는다.

## 1. 구조

| 패키지 | 역할 | 규모·근거 |
|---|---|---|
| `@mytangerine/core` | 도메인 타입 · `SheetService`(922) · `DatabaseService`(1109) · `HybridDataService`(644) · `SyncEngine`(402) · 분산 락 · 변경 이력 · 라벨/PDF/Excel 포매터 | src 4,876 LOC(테스트 제외) · tsup cjs+esm · **`dts: false`**(`tsup.config.ts`) |
| `@mytangerine/api` | Fastify 4.29 REST · Swagger(`/docs`) · PDF/Excel 생성 | `routes/orders.ts` 단일 파일에 라우트 20여 개 |
| `@mytangerine/web` | Next.js 16.1.1 · React 19 · TanStack Query v5 · ky | 페이지: `/dashboard` `/orders` `/orders/[id]`(861줄) `/labels`(815줄) `/stats` · sync 프록시 3개 |
| `@mytangerine/sync-service` | node-cron(기본 1분) Sheets → DB 증분 동기화 | 테스트 0 |

### 데이터 흐름

| `DATA_SOURCE` | 읽기 | 쓰기 |
|---|---|---|
| `sheets` | Sheet | Sheet |
| `database` | DB | DB |
| `hybrid` | DB → 실패 시 Sheet | DB → Sheet 순차, **한쪽 실패는 삼킴** |

- 모드 값은 `packages/api/src/plugins/core.ts:55` 에서 검증 없이 캐스팅 — 오타면 hybrid 로 동작한다
- 상태: `신규주문` → `입금확인` → `배송완료` (시트 `비고` 컬럼 · `types/order.ts:32`). 레거시 `''`·`'확인'` 정규화
- claim(배송사고): DB 전용, `sheetRowNumber=null` · `originalRowNumber` · 생성 시 `입금확인`(#169)
- sync: 시트 → DB upsert(키 `sheetRowNumber @unique`) → 시트에 `DB_SYNC_STATUS/AT/ID` 기록. 분산 락 `'sync'` TTL 20분

## 2. 검증 기준선 (2026-11-17 로컬 실측 · Node 20.18 · pnpm 9.14)

| 패키지 | lint | 타입 | 테스트 | 빌드 |
|---|---|---|---|---|
| core | ❌ 2 errors(`prefer-const` sheet-service.ts:712,741) · 4 warnings | ❌ TS 4건(아래) | ✅ 86 | ✅ |
| api | ❌ eslint 설정 파일 없음 | ❌ TS 45건 — 대부분 TS7016(core d.ts 없음) | ✅ 74 | ✅ |
| web | ❌ `next lint` 깨짐(Next 16 에서 제거 · "Invalid project directory …/lint") | (빌드가 대신) | ✅ 16 | ✅ |
| sync-service | 스크립트 없음 | ❌ TS 4건(TS7016 · `cron` namespace) | 없음 | ✅ |

core TS 오류: `change-log-service.ts:6` `OrderChangeLog` 없음(TS2305 — 낡은 생성 client) · `sync-engine.ts:98,208,340` `SheetRow` 인덱스(TS7053).
**빌드는 tsup/next 가 타입을 보지 않아서 통과한다** — 패키지 간 타입 안전성이 사실상 꺼져 있다.

## 3. 위험 목록

| 등급 | 항목 | 근거 |
|---|---|---|
| 높음 | 쓰기·내보내기 라우트 인증 없음 + CORS `*` + rate limit 없음 → 고객 이름·전화·주소 대량 다운로드 가능 | `orders.ts`·`labels.ts` preHandler 0 · `config.ts:29` · `excel-generator.ts:54-63` |
| 높음 | web `/api/sync`·`/api/sync/full` 프록시가 호출자 인증 없이 서버 키를 붙여 전달 → 누구나 전체 재동기화(최대 20분) | `packages/web/src/app/api/sync/route.ts:12` |
| 높음 | hybrid 부분 실패 삼킴 · 트랜잭션 0 · 낙관적 잠금 미작동 → 시트/DB 조용한 불일치·갱신 유실 | `hybrid-data-service.ts:245` 외 · `change-log-service.ts:72,96-103` |
| 높음 | Prisma 마이그레이션 이원화 · 문서마다 deploy 위치가 다름 | `.claude/rules/data-safety.md` · `DATABASE_SETUP_QUICKSTART.md:218` vs `phase-2-1-setup-guide.md:137` |
| 높음 | 증분 sync 가 `success` 행을 건너뜀 → 동기화 뒤 시트에서 고친 내용이 DB 에 안 들어갈 수 있음(다른 경로가 상태를 초기화하는지 **미확인**) | `sync-engine.ts:339-345` |
| 높음 | 시트 행 번호가 upsert 키 → 시트에서 행 삽입·삭제 시 다른 주문을 덮어쓸 위험 | `schema.prisma:21` · `database-service.ts:780` |
| 높음 | 보안 이슈 #172 장기 미해결 · dependabot PR 19개 적체(next 보안 패치 포함) | GitHub |
| 중간 | 타입체크·lint 전 패키지 실패, CI 미검출(web·sync-service 는 CI 밖) | 2절 · `ci.yml` |
| 중간 | `updateCell` 이 임의 컬럼명을 Prisma 필드로 `as any` 전달 (`DB_SYNC_ID`→`id`) | `database-service.ts:719-734` |
| 중간 | 행 번호 없는 `markAsConfirmed()` 가 claim 주문까지 일괄 변경 가능 | `database-service.ts:323,341-358` |
| 중간 | PDF/Excel 오류 시 `error.message` 그대로 응답 | `orders.ts:558-560` 외 |
| 중간 | web sync 프록시가 `TimeoutError` 를 못 잡아 504 대신 500 | `web/src/app/api/sync/route.ts:45` |
| 중간 | 테스트 공백 — DatabaseService·HybridDataService·SyncEngine·ChangeLog·Lock 0, api 쓰기 라우트·인증 0, sync-service 0 | 에이전트 실측 |
| 중간 | PWA 가 Turbopack 빌드에서 SW 를 만들지 않을 가능성 · manifest 아이콘 없음 (**미확인**) | `next.config.mjs` |
| 낮음 | API 키 비교가 상수시간 아님 · `x-app-client` 위조 가능 | `auth.ts:43,78` |
| 낮음 | 운영 코드 `console.*` · 실명 하드코딩(Excel 제목) | `excel-generator.ts:77` |
| 낮음 | 잔재: Python 15파일 · `getLabel.py.old` · 빈 `packages/packages/web`(untracked) | — |

## 4. 문서·트래커 위생

- **낡은 문서**: CLAUDE.md 개요(Python 앱 설명 — 이번 세션에서 교체) · ROADMAP.md(2025-12-19 기준, Phase 3 "대기") · README(Next 14 · 다크모드 "지원" 표기 — 실제 0)
- **이슈**: 열린 14개 중 #9·#10·#13·#27 은 사실상 완료로 보임 · #15(PM2 배포)·#63(#91 과 중복) 방치 · #34 다크모드 미구현 · #143 진행 중
- **PR**: 열린 19개 전부 dependabot. 중복(fastify 5 ×3 · next ×2). Fastify 5 는 cors·plugin·swagger 와 묶음 업그레이드 필요
- engines `node >=18.17` vs CI·README Node 20 · `packageManager` 필드 없음
- 배포 방식(PM2·서버)은 저장소에 설정이 없어 **미확인**

## 5. 권장 순서 (제안 — 결정은 사용자)

1. **API 인증** — orders·labels 라우트에 인증 + CORS 허용 목록 + rate limit. web 프록시에 호출자 인증 (보안 · 높음 · 범위 중)
2. **Prisma 단일화** — 실제 DB 의 `_prisma_migrations` 를 사용자가 확인 → 정본 스키마 하나로 통합, generate 경로 정리 (데이터 · 높음 · 사용자 확인 필수)
3. **검증 복구** — core `dts` 재활성화(`build:types`) · TS 오류 8건 · eslint 설정(api)·`next lint` → `eslint` 전환 · CI 에 type-check·web·sync-service 추가 · lint `continue-on-error` 해제
4. **hybrid 정합성** — 부분 실패를 호출자에게 알리거나 재시도 큐 · `$transaction` · version 조건부 update · 핵심 서비스 테스트
5. **의존성 정리** — #172 · dependabot 묶음(보안 우선 → Fastify 5 묶음 → 메이저)
6. **위생** — 죽은 Python 코드 제거 · ROADMAP/README 갱신 · 완료 이슈 닫기
