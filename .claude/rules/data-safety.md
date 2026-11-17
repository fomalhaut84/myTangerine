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
| **S-6** | 마이그레이션은 **추가만** 한다(기존 마이그레이션 파일 수정·삭제 금지). 아래 *주의 — 스키마 두 벌* 을 먼저 읽는다 | 없음 |
| **S-7** | 시트 컬럼명(한국어 · `타임스탬프` `비고` `보내는분` `받으실분` `상품 선택` `5kg 수량` `10kg 수량` …)은 **외부 계약**이다. 바꾸거나 새 컬럼을 요구하는 변경은 사용자 확인 후, 시트 쪽 작업을 사용자에게 전달한다 | 없음 |

## 주의 — Prisma 스키마 두 벌 (2026-11-17 실측)

- `prisma/schema.prisma`(루트 · 루트 `postinstall` 이 generate) 와 `packages/core/prisma/schema.prisma` 는 모델이 같고 주석 2줄만 다르다.
  generator `output` 이 상대경로라 **어느 스키마로 generate 하느냐에 따라 client 생성 위치가 달라진다**. pnpm 의 `@prisma/client` 는
  `node_modules/.pnpm/@prisma+client@*/node_modules/.prisma` 를 읽는데, 루트 generate 는 루트 `node_modules/.prisma` 에 쓴다.
  그래서 실측에서 core 가 읽는 client 가 낡아 있었다(`OrderChangeLog` 없음 → core `type-check` TS2305).
- 마이그레이션 이력은 **갈라져 있다** — 루트 7 · core 6. 같은 것은 `init` · `add_distributed_locks` · `add_original_row_number` 3개뿐이다.
  core 에는 `add_order_type` · `add_phase2_change_log` 가 **없다** → core 스키마로 deploy 하면 그 컬럼·테이블이 빠진 DB 가 된다.
  이름이 다르므로 한쪽으로 적용한 DB 에 다른 쪽을 deploy 하면 "already exists" 로 실패한다.
- 어느 쪽이 실제 DB 에 적용된 이력인지는 `_prisma_migrations` 테이블로만 판정된다 — **추정하지 않는다.** 스키마 변경 전에
  `npx prisma migrate status` 를 양쪽 스키마로 돌려 사용자에게 보고하고 어느 쪽에 추가할지 확인받는다.

## 막혔을 때

훅에 막히면 **우회하지 않는다**(변수 치환 · 스크립트 파일로 감싸기 · 다른 도구로 같은 일 하기 모두 우회다).
사용자에게 무엇을 왜 실행해야 하는지와 되돌리는 법을 적어 `! <명령>` 으로 직접 실행하도록 요청한다.
