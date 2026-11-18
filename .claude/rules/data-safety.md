# 데이터 안전 규칙

myTangerine 은 **실제 감귤 주문**을 다룬다. 구글 스프레드시트 "감귤 주문서(응답)" 은 고객이 구글 폼으로 넣는 **정본 입력**이고,
PostgreSQL 은 그 시트에서 동기화된 사본 + DB 전용 데이터(배송사고 claim 주문 · 변경 이력 · soft delete)를 가진다.
되돌릴 수 없는 손실은 **고객 주문 유실**이다. 이 파일이 정본이고 `.claude/hooks/safety_guard.py` 는 실수 방지 장치다.

## 규칙

| ID | 규칙 | 훅 |
|---|---|---|
| **S-1** | 비밀(`.env` · `credentials.json` · `API_SECRET_KEY` · 서비스 계정 키)을 출력·커밋·외부 전송하지 않는다. 키 이름만 필요하면 `sed 's/=.*/=<redacted>/' .env` | 차단(읽기 명령) · Read deny |
| **S-2** | **실제 시트에 쓰는 작업은 사용자 확인 후에만.** `scripts/add-sync-columns.js` · `check-and-add-columns.js` 는 사용자가 직접 실행한다. 시트 쓰기 코드(`SheetService` 의 update/mark 계열)를 실행하는 수동 테스트도 같다 | 차단(두 스크립트) |
| **S-3** | DB 파괴 금지 — `prisma migrate reset` · `db push --force-reset` · `--accept-data-loss` · `db execute` · psql `DROP/TRUNCATE/DELETE` · `dropdb`. 필요하면 백업(`pg_dump`) 명령과 함께 사용자에게 요청한다 | 차단 |
| **S-4** | 테스트는 실제 시트·실 DB 에 닿지 않는다. 새 테스트는 `SheetService`/Prisma 를 mock 한다(기존 `__tests__` 패턴). CI 의 `DATABASE_URL` 은 더미다 | 없음 — 리뷰에서 본다 |
| **S-5** | `DATA_SOURCE`(sheets · database · hybrid) 를 바꾸는 변경은 **동기화 방향이 바뀌는 변경**이다. 착수 전 사용자 확인 + 되돌리기 절차를 PR 에 적는다 | 없음 |
| **S-6** | 마이그레이션은 **추가만** 한다(기존 마이그레이션 파일 수정·삭제 금지). 아래 *Prisma 스키마 — 정본 하나* 를 먼저 읽는다. 예외: 운영 `_prisma_migrations` 로 **정본이 아님이 확인된** 갈라진 사본(정본과 같은 내용의 복제본 · 운영 미적용 파일)의 정리는 사용자 승인 하에 한다(전례 #208) | 없음 |
| **S-8** | **저장소는 PUBLIC 이다.** 고쳐지지 않은 보안 취약점의 위치(`파일:줄` · 라우트 · 우회 방법)를 이슈·PR 본문·커밋 메시지·추적 문서에 적지 않는다. 이슈 제목·본문은 "API 보안 강화" 처럼 일반화하고, 상세는 로컬 전용 `docs/research/project-analysis.md`(gitignore) 에만 둔다. 공개는 수정이 배포된 뒤. 전례: PR #193 첫 커밋 `76c2465` 에 분석 문서가 올라가 공개됐다 | 없음 — 커밋 전 본다 |
| **S-7** | 시트 컬럼명(한국어 · `타임스탬프` `비고` `보내는분` `받으실분` `상품 선택` `5kg 수량` `10kg 수량` …)은 **외부 계약**이다. 바꾸거나 새 컬럼을 요구하는 변경은 사용자 확인 후, 시트 쪽 작업을 사용자에게 전달한다 | 없음 |

## Prisma 스키마 — 정본 하나 (#208 · 2026-11-18)

- 정본은 **루트 `prisma/schema.prisma` + `prisma/migrations/`** 하나다. 운영 DB `_prisma_migrations` 가 이 이력 7개와 일치한다
  (2026-11-18 사용자 서버 `migrate status` — "up to date"). 마이그레이션은 여기에만 추가한다.
- 갈라져 있던 `packages/core/prisma/`(스키마 + 마이그레이션 6개 — 3개는 루트와 바이트 단위로 같은 복제본, 3개는 운영 미적용이며
  그 컬럼·인덱스는 루트 `add_phase3_columns` · `add_orderer_columns` 에 들어 있다)는 #208 에서 지웠다 — 내용은 git 이력에 있다.
  되살리지 않는다(core 이력으로 deploy 하면 `add_order_type` · `add_phase2_change_log` 가 빠진 DB 가 된다).
- generator 에 `output` 을 **지정하지 않는다.** client 는 `@prisma/client` 가 실제로 읽는 pnpm 저장소 안 기본 위치에 생성된다.
  예전 상대경로 output(`../node_modules/.prisma/client`)은 core 가 낡은 타입이나 "did not initialize yet" 껍데기를 읽게 만들었다.
  회귀 테스트: `packages/core/src/__tests__/prisma-client.test.ts`
- 스키마 변경 전에 `npx prisma migrate status` 결과를 사용자에게 받아 운영 이력과 맞는지 확인한다 — **추정하지 않는다.**
- **Prisma 7 (#241):** 접속 주소는 스키마가 아니라 루트 `prisma.config.ts`(dotenv 로 루트 `.env`)에 있다. CLI 는 저장소 루트에서 실행한다.
  client 는 `new PrismaClient()` 대신 core `createPrismaClient()`(`@prisma/adapter-pg`)로만 만든다 — `.env` 를 스스로 읽지 않으므로
  서비스가 먼저 루트 `.env` 를 읽어야 하고, `DATABASE_URL` 이 없으면 기동을 멈춘다(엉뚱한 DB 에 붙지 않게)

## 막혔을 때

훅에 막히면 **우회하지 않는다**(변수 치환 · 스크립트 파일로 감싸기 · 다른 도구로 같은 일 하기 모두 우회다).
사용자에게 무엇을 왜 실행해야 하는지와 되돌리는 법을 적어 `! <명령>` 으로 직접 실행하도록 요청한다.
