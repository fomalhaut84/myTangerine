# 인계 노트 — 2026-11-17, 운영 장애 복구 · 자동 배포 · 의존성 보안 정리

직전 노트: `2026-11-17-harness-setup-analysis.md`. 이 노트가 최신이다.

**실데이터 영향 (있음 — 모두 사용자가 서버에서 실행):**
- 운영 PostgreSQL 18: `mytangerine` 계정 비밀번호를 SCRAM 으로 재설정(md5 해시가 남아 인증 실패하던 상태 — 아래 1)
- 시트 → DB **전체 동기화 1회**(`/api/sync/full` · total 388 · 성공 363 · 충돌 25 · 실패 0) — 충돌 25건은 DB 값 유지(덮어쓰지 않음)
- **배포 3회**: `v1.1.1`(손 배포) · `v1.1.2`(부트스트랩 손 배포 + Actions 확인) · `v1.2.0`(**첫 자동 배포** · 통과)
- 서버 `~/.ssh/authorized_keys` 에 배포 전용 키 1줄(forced command) · GitHub environment `production` secrets — 사용자 설정
- 로컬: 띄운 프로세스 없음 · 로컬 DB 무접촉

**관측 시점:** dev `3d321c0` · main `f2d87d2` (`v1.2.0`) · 열린 PR 0 (dependabot #147 · #148 · #122 — 보류) · CI(dev) success · Security Audit success

## 이 세션에서 한 일

1. **배송사고 주문 배송완료 400** — 두 개의 버그:
   - #194 → PR #195: 시트 모드(및 hybrid 의 시트 폴백)에서 claim 판정이 DB 전용 `_orderType` 에만 의존
   - #199 → PR #200: 시트에 있는 claim 행이 `idType: dbId` 로 표시돼 배송완료 가드(dbId 는 시트 행 없는 claim 만)에 막힘 → `resolveOrderIdType`
   - 릴리즈 `v1.1.1`
2. **운영 DB 인증 장애 발견·복구** — `DATA_SOURCE=hybrid` 인데 DB 인증 실패(`does not have a valid SCRAM secret` · PostgreSQL 18 · md5 해시 잔존)로 **모든 조회가 시트로 무음 폴백**하고 있었다. 로그도 남지 않았다(원인 미확인). 사용자가 `\password` 로 SCRAM 재설정 → 전체 동기화. 서비스는 6개월 미사용이라 데이터 손실 정황 없음(DB 최종 갱신 1월 21일 = 서비스 최신 주문)
3. **자동 배포** #201 → PR #203 · 릴리즈 `v1.1.2`(부트스트랩) — Release 발행 → Actions → ssh forced command → `deploy/release-inplace.sh`. 런북 `docs/runbooks/auto-deploy.md`. 후속 #202(별도 디렉터리 빌드)
4. **의존성 보안 정리** — `pnpm audit` **205(critical 9) → 0**, dependabot PR 19개 중 16개 반영·닫음:
   - #205 메이저 아닌 일괄(next 16.4.6 · vitest 4 · overrides) · #207 Actions · CI Node 24 · #210 **Fastify 5**(#63) · #211 **zod 4**(#91) · #213 `@types/node` 24 · #215 개발 도구 2건(#172 닫힘)
   - 릴리즈 `v1.2.0` — **첫 자동 배포 · 통과**(빌드 31s · 헬스 api/web 200 · pm2 online)
5. 이슈 정리 — #196(API 보안 · 일반화된 제목 · S-8) · #197(hybrid 부분 실패 — 이번 장애 관찰 5건 코멘트) · #202 · #208(Prisma 단일화 → 7) · #209(Tailwind 4). 마일스톤 `v1.2.0 — 보안·안정화`
6. 하네스: `data-safety.md` S-8(공개 저장소 — 미해결 취약점 위치 비공개) · 분석 문서 gitignore · 훅 Codex P2 반영(push 대상 해석 · 따옴표 인식)

## 결정된 것

| 결정 | 근거 |
|---|---|
| 리뷰는 pleiades 방식(사전 에이전트 → Codex bot) · resume/handoff pleiades 형식 · `.claude/` 추적 | 사용자 |
| 분석 문서(보안 위험 목록)는 로컬 전용 — 공개 저장소 | 사용자("ignore 처리") · S-8 |
| **Release 발행 = 자동 배포** · 실패 시 자동 롤백 없음(안내만) · 배포 알림은 나중에 | 사용자 |
| 스키마 변경 릴리즈는 `--prerelease`(수동) · 서버 조치 릴리즈는 `--draft` | 런북 · workflow.md |
| 의존성은 위험도별 PR 분리 · 보안 무관 메이저는 이슈로(Prisma 7 #208 · Tailwind 4 #209) · `@types/node` 25 닫음(런타임 24) | 사용자 승인 |
| Security Audit workflow 재활성화(매주 월 03:00 UTC) | 사용자 |

## 결정되지 않은 것

- **운영 DB 가 루트·core 중 어느 마이그레이션 이력을 따르는가** — 사용자가 `_prisma_migrations` 이름 목록 확인 → #208 착수 조건
- 전체 동기화의 **충돌 25건**이 실제로 값이 다른지 — `GET /api/orders/conflicts?resolved=false` 의 필드 이름만 확인 요청했으나 결과 미수신
- hybrid 폴백 경고가 운영 pm2 로그에 남지 않은 이유(LOG_LEVEL=info 인데 앱 로그 0줄) — #197 에 기록
- 서버 pnpm 10 vs CI pnpm 9 정렬 여부(#206 범위 밖으로 남김)

## 다음 세션의 첫 액션 후보

1. **#196 API 보안 강화(최우선)** — 운영 API 가 공개 도메인에서 응답한다. 세부는 로컬 `docs/research/project-analysis.md` 3절. 설계(웹 → API 인증 방식) 먼저 · 사용자 승인. 급하면 서버 앞단 임시 접근 제한(사용자 서버 작업)
2. **v1.2.0 운영 확인 결과 받기** — 웹 주문 수정(PATCH) 1회(사용자). 실패 시 `deploy/release-inplace.sh v1.1.2 --yes --allow-downgrade`
3. #197 hybrid 부분 실패 · 폴백 무음 — 이번 장애의 근본 원인 쪽
4. #208 Prisma 단일화 — 사용자 DB 확인 후
5. #202 별도 디렉터리 빌드 · #209 Tailwind 4 · 검증 체계 복구(core d.ts · 타입 기준선 4/45/4 · lint)

## 주의사항

- **로컬 Node 24 필요** — Fastify 5 이후 API 는 Node ≥ 20.19(`.nvmrc` v24). 로컬 nvm 기본 20.18 에서는 기동·테스트 실패. Bash 에서는 `PATH="/usr/local/bin:$PATH"`(v24.22)로 검증했다
- **타입·lint 기준선**: core 4 · api 45 · sync-service 4 (TS 오류) · core lint 2 errors — 새 작업은 기준선과 비교해 보고
- **서버 환경**: Node 24.12 · pnpm 10.24 · pm2 `myTangerineApi` · `myTangerineSync` · `myTangerineWeb` · 체크아웃 `~/myTangerine` · 같은 계정에 pleiades 앱도 있다(포트 충돌 주의)
- **sync-service 는 운영에서 돌고 있다(1분 주기 · 실제 시트에 쓴다)**
- 자동 배포 성공 기록: 서버 `~/mytangerine-private/last-ok` = `v1.2.0`. 손 배포 뒤에는 `--confirm-manual` 로 기록을 맞춘다
- **PR #193 이 merge commit 으로 머지돼** 분석 문서가 든 커밋 `76c2465` 가 dev·main 이력에 있다(현재 트리에는 없음 · 공개 저장소)
- 피쳐 PR 은 squash · 릴리즈 PR 은 merge commit — 이번 세션에서 한 번 뒤바뀌었다
- 고객 개인정보가 대화에 붙여진 적이 있다 — 문서·이슈·커밋에는 옮기지 않았다
- stale: ROADMAP.md(2025-12 기준) · README(Next 14 · 다크모드 표기)

## 재현이 필요한 절차

- **PostgreSQL 18 SCRAM 재설정**: `sudo -u postgres psql` → `SET password_encryption='scram-sha-256';` → `\password mytangerine` → 확인 `select left(rolpassword,13) from pg_authid where rolname='mytangerine'` = `SCRAM-SHA-256`
- **전체 동기화**(웹에 버튼 없음): 서버에서 `curl -X POST localhost:$PORT/api/sync/full -H "x-api-key: …(.env 에서)" -H 'x-app-client: sync-service'` — 응답에 `conflicts` 수가 빠진다(#197)
- **pnpm peer 의존성은 overrides 가 먹지 않는다** — devDependencies 로 직접 명시(vite · webpack 사례)
