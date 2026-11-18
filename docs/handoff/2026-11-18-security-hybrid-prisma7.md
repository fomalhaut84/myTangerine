# 인계 노트 — 2026-11-18, API 보안 강화 · hybrid 부분 실패 · Prisma 단일화·7

직전 노트: `2026-11-17-ops-recovery-auto-deploy-security.md`. 이 노트가 최신이다.

**실데이터 영향 (있음 — 모두 사용자가 서버에서 실행):**
- **배포 3회**
  - `v2.0.0`: `--draft` → 서버 `.env` 추가 → Publish → 자동 배포 · 통과
  - `v2.1.0`: `--prerelease` → 수동 배포
  - `v2.2.0`: `--prerelease` → 수동 배포 + Prisma 7 점검 A·B 통과
- **nginx 변경(사용자):**
  - 같은 도메인 경로 분기
  - 외부 `/api` 차단(외부에서 401 확인)
  - `/bff/api/sync` · `/bff/api/orders/report` 프록시 타임아웃
  - 설정 파일은 저장소에 없다(도메인 포함 — 커밋 금지)
- **서버 `.env` 추가(사용자):** `SESSION_SECRET` · `ADMIN_PASSWORD_HASH` 등 웹 로그인 키(#219) — 값은 기록하지 않는다
- **DB:**
  - 스키마·SQL 변경 0
  - `pg_dump` 백업 2개(`~/mytangerine-20261118-*.dump` · v2.1.0 · v2.2.0 직전)
  - v2.1.0 때 `sudo` 인증 실패로 0바이트 dump 가 생겼을 수 있다고 안내했다 → 사용자가 백업 정상 확인
  - **운영 DB 접속이 Prisma 7 드라이버 어댑터(node-pg)로 바뀌었다**
- **시트:** 쓰기 작업 없음(수동 확인은 웹 주문 수정 1~2건 — 정상 hybrid 쓰기)
- **로컬:**
  - 띄운 서비스 프로세스 없음 · 사용자 로컬 DB 무접촉
  - 일회용 PostgreSQL 15 클러스터를 세션 scratchpad 에 만들었다가 정지했다(`mt_scratch` · `mt_scratch2` · `mt_scratch3` — scratchpad 와 함께 사라진다)

**관측 시점:** dev `5bee3dd` · main `cc9993c` (`v2.2.0`) · dev 가 main 을 포함(main-only 0) · 열린 PR 0 (dependabot 제외) · CI(dev) 진행 중(관측 시점)

## 이 세션에서 한 일

1. **#196 API 보안 강화** — 하위 3개 · 한 릴리즈 `v2.0.0`. 공개 저장소라 상세는 로컬 `project-analysis.md` 에만 둔다(S-8)
   - #218 → PR #221
     - API 키 전역 훅(sha256 + timingSafeEqual)
     - rate limit 은 인증보다 먼저
     - CORS 허용 목록
     - 운영 설정 검증
   - #219 → PR #224
     - 관리자 비밀번호 로그인: HMAC 세션 · scrypt(`:` 구분 — Next dotenv `$` 확장 회피)
     - 로그인 제한: IP당 5회/10분 · 동시 2
     - open redirect 방어
     - 서비스워커는 정적 자원만 캐시
     - 전역 실패 상한 `LOGIN_GLOBAL_MAX_FAILURES` 기본 0(끔)
   - #220 → PR #226
     - BFF `/bff/api/*` — 브라우저는 API 키를 모른다
     - 타임아웃: 기본 30s · 보고서 2분 · sync 5분(undici 300s)
2. **#197 hybrid 부분 실패** → PR #230
   - 순서는 DB 우선:
     - DB 실패 → 시트에 쓰지 않고 503(`HybridWriteError`)
     - DB 성공 · 시트 실패 → `syncStatus='failed'` + 응답 `warnings` → 웹 토스트 "부분 저장"
   - DB 쓰기와 변경 이력은 한 트랜잭션
   - 봇 P2 반영: 일반 쓰기가 성공해도 실패 표시를 지우지 않는다. 지우는 것은 #231(행 전체 재조정)
3. **#222 picomatch** → PR #233
   - 패치 버전이 없어 `pnpm.auditConfig.ignoreGhsas` 로 예외 등록
   - 주간 감사는 `.advisories` 로 센다 — pnpm 은 `metadata` 와 종료 코드에 예외를 반영하지 않는다
   - 재검토 #232
4. **#208 Prisma 단일화** → PR #235
   - 사용자 서버 `migrate status` 로 정본 = 루트 `prisma/` 확인
   - `packages/core/prisma` 삭제(사용자 승인 · S-6 예외 문구)
   - generator `output` 제거 — core 가 미생성 껍데기·낡은 client 를 읽던 문제를 로컬에서 재현하고 고쳤다
   - 운영이 그동안 동작한 이유: pnpm 10 이 `@prisma/client` 설치 스크립트를 건너뛰어 껍데기가 생기지 않았다
5. **#234 타입 결함** → PR #240
   - `markAsConfirmed` 는 행 번호를 명시해야만 처리한다(사용자 결정)
   - 예전에는 빈 입력이 DB 에서 입금확인을 포함한 미완료 주문 전부를 배송완료로 바꿨다 — 이력 NOT NULL 실패 덕에 우연히 막혀 있었다
   - `hasSheetRow` 가드 추가
   - core 타입 에러 8 → 3
6. **#241 Prisma 7.10.1** → PR #242
   - generator 는 `prisma-client-js` 유지(사용자 결정)
   - `@prisma/adapter-pg` · core `createPrismaClient`
     - `DATABASE_URL` 이 없으면 기동 중단
     - 대기 10초
     - `?schema=` 반영
     - 풀 오류를 로그로
   - 루트 `prisma.config.ts`
   - 일회용 PG 로 마이그레이션·트랜잭션·롤백 실측
   - 런북 *Prisma 7 전환 배포 점검*(사용자 요청)
   - dependabot #147 · #148 닫음
7. **릴리즈·배포**
   - 순서: `v2.0.0`(#227) → `v2.1.0`(#236) → `v2.2.0`(#244)
   - 런북 수동 배포 순서 정정 #237 → PR #238: sync 재개를 `--confirm-manual` 앞으로 — 헬스 확인이 pm2 앱 3개 모두 online 을 요구
   - #244 · #247 이 **squash 로 머지돼** 이력이 갈라졌다 → #246 → PR #248(merge commit)로 복구
8. 후속 이슈 등록:
   - #231 시트 반영 자동 재시도
   - #232 감사 예외 재검토
   - #239 일괄 확인 정리
   - #243 새 generator
   - #245 sheets 모드에서 DB 주소 없이 기동

## 결정된 것

| 결정 | 근거 |
|---|---|
| 웹 접근 = 관리자 비밀번호 로그인 · 호출 = BFF · 운영 = 같은 도메인 경로 분기 · 하위 이슈 3개 한 릴리즈 | 사용자 2026-11-18 (#196) |
| 로그인 전역 실패 상한은 기본 끔 · env 로 켬 | 사용자 (관리자 잠금 위험) |
| hybrid 쓰기 = DB 우선 · DB 실패 시 중단 · #197 은 정책 + 트랜잭션 | 사용자 (#197) |
| 시트 반영 자동 재시도는 후속(#231) — 실패 표시 해제도 #231 이 담당 | 사용자 · 봇 P2 |
| picomatch = 예외 등록 + 재검토 | 사용자 (#222) |
| 정본 Prisma = 루트 `prisma/` · core 사본 삭제(S-6 예외) | 사용자 서버 `migrate status` · 승인 (#208) |
| 드러난 타입 결함은 후속 분리(#234) · `markAsConfirmed` 는 행 번호 필수 | 사용자 |
| Prisma 7 은 `prisma-client-js` 유지 · 새 generator 는 #243 | 사용자 (#241) |
| 버전 v2.0.0(서버 조치 · 호환성 변경) · v2.1.0 · v2.2.0 | 사용자 |

## 결정되지 않은 것

- **#231 자동 재시도 설계** — 주체(sync-service cron 인지 api 인지) · 쓸 값(DB 현재 값 전체 행 — 멱등) · 실제 시트에 쓰는 자동 작업이라 S-2 승인 필요
- **#245** — sheets 모드 + URL 없음일 때 어떤 형태로 기동할지(접근 시 throw 하는 대체 객체 · 라우트 503)
- **#243 시점** — Prisma 8 정식 전. npm `latest` 가 이미 8.0.0-rc 다

## 다음 세션의 첫 액션 후보

1. **#245** — 작고 독립적. 코드만 · 데이터 영향 없음
2. **#239** — 시트 모드 하위호환 경로 정리 · 응답에 실제 처리 건수. 시트 쓰기 코드라 S-2 · 감사 필요
3. **#243 새 generator** — client 를 core 안에 생성. 빌드·import 변경 · `--prerelease`
4. **#231 자동 재시도** — 설계 승인 먼저
5. #228 · #229 · #223 · #202 · #209 · #232(picomatch 패치 나오면)

## 주의사항

- **릴리즈·이력 복구 PR 은 squash 로 머지되기 쉽다**
  - GitHub 가 피쳐 PR 에서 쓴 squash 를 머지 버튼 기본값으로 기억한다. 오늘 #244 · #247 이 그렇게 들어갔다
  - 요청할 때 "▼ 에서 **Create a merge commit** 을 직접 고른다" 고 명시하고, 머지 뒤 부모 2개를 확인한다(`release` 스킬 보강함)
- **Prisma 7 운영 동작**
  - client 는 `.env` 를 스스로 읽지 않는다. 서비스가 실행 위치에서 위로 올라가 루트 `.env` 를 먼저 읽는다
  - 운영 pm2 세 앱의 cwd 는 `~/myTangerine`(2026-11-18 확인)
  - `DATABASE_URL` 이 없으면 api 가 기동하지 않는다(sheets 모드 포함 — #245)
  - 운영 `.env` 에 `sslmode` 없음(localhost 평문) — 넣으면 node-pg 는 TLS 를 요구한다
- **hybrid 무음 폴백 확인법**
  - pm2 online 만으로는 DB 장애를 모른다. 로그에서 `hybrid-fallback` 을 찾는다
  - 런북 점검 B 는 재시작 직전 로그 오프셋 이후만 본다
- **타입 체크 기준선**(dev `5bee3dd`): core 3(sync-engine TS7053) · api 45 · sync-service 4 · lint 전 패키지 실패(기존)
- **#231 이 없는 동안** 시트 반영 실패 표시(`syncStatus='failed'`)는 한 번 붙으면 계속 남는다(의도 · 봇 P2)
- 서버에 남은 옛 루트 `node_modules/.prisma`(v6 생성물)는 무해. 지워도 된다(선택 · 사용자)
- 메모리 `v120-patch-confirmed` 는 반영 완료로 삭제했다

## 재현이 필요한 절차

- **Prisma 7 배포 점검:** 런북 `docs/runbooks/auto-deploy.md` *Prisma 7 전환 배포 점검*. 2026-11-18 v2.2.0 에서 A·B 모두 통과했다
- **squash 된 릴리즈 이력 복구:** `git checkout -b feature/issue-<N>-sync-main dev && git merge -s ours --no-ff origin/main` → PR(base dev) → **merge commit** 머지 → `git merge-base --is-ancestor origin/main dev`
- **일회용 PG 로 Prisma 실측(로컬):**
  - 클러스터: `initdb -D <scratch>/data -U tester --auth=trust` → `pg_ctl -o "-p 55439 -k '' -c listen_addresses=127.0.0.1" start`
    - `-k ''` 를 쓰는 이유: scratchpad 경로가 길어 unix 소켓 경로 103바이트 제한에 걸린다
  - DB: `createdb` → `DATABASE_URL=… pnpm exec prisma migrate deploy`
  - `dropdb` 는 훅이 막는다(S-3) — 새 이름으로 만든다
