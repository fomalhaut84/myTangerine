# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 언어 / Language

**이 프로젝트에서는 한국어로 대화를 진행합니다.** Claude Code와의 모든 커뮤니케이션은 한국어로 이루어지며, 세션이 재시작되더라도 한국어를 계속 사용해야 합니다.

**All communications in this project should be in Korean.** Even if the session restarts, continue using Korean.

## 현재 상태

세션마다 맨 위에 한 문단을 추가한다(`tangerine-handoff`). 새 세션은 이 절과 최신 인계 노트로 시작한다(`tangerine-resume`).

**2026-11-18 · API 보안 강화 · hybrid 부분 실패 · Prisma 단일화·7 — `v2.0.0` · `v2.1.0` · `v2.2.0`(모두 운영 배포 · 통과).** #196 보안(#218 API 키·rate limit·CORS → #221 · #219 관리자 로그인 → #224 · #220 BFF → #226) · #197 hybrid DB 우선·부분 실패 경고·트랜잭션(#230) · #222 picomatch 감사 예외(#233) · #208 Prisma 정본 루트 하나·client 생성 위치(#235) · #234 일괄 확인은 명시한 행만(#240) · #241 **Prisma 7.10.1** 드라이버 어댑터·`prisma.config.ts`(#242) · 런북 수동 배포 순서·Prisma 7 점검 · 릴리즈 squash 이력 복구(#248). **실데이터 영향: 배포 3회 · nginx 경로 분기 · 서버 `.env` 로그인 키 · DB 접속이 node-pg 어댑터로(스키마 변경 0) — 모두 사용자 실행.** 인계 `docs/handoff/2026-11-18-security-hybrid-prisma7.md`. 다음 = **#245 sheets 모드 기동** · #239 · #243 새 generator · #231 자동 재시도(설계 승인).

**2026-11-17(오후) · 운영 장애 복구 · 자동 배포 · 의존성 보안 정리 — `v1.1.1` · `v1.1.2` · `v1.2.0`(첫 자동 배포 · 통과).** 배송사고 배송완료 400 두 건(#194 → #195 · #199 → #200) · **운영 DB 인증 장애**(PostgreSQL 18 md5 잔존 → hybrid 가 시트로 무음 폴백 · 사용자 SCRAM 재설정 · 전체 동기화 388 · 충돌 25) · 자동 배포 #201 → #203(Release 발행 = 배포 · 런북 `docs/runbooks/auto-deploy.md`) · `pnpm audit` 205 → 0(#205 · #207 CI Node 24 · #210 Fastify 5 · #211 zod 4 · #213 · #215 · #172 닫힘 · dependabot 16 정리). **실데이터 영향: DB 비밀번호 재설정 · 전체 동기화 · 배포 3회(모두 사용자 실행).** 인계 `docs/handoff/2026-11-17-ops-recovery-auto-deploy-security.md`. 다음 = **#196 API 보안 강화** · v1.2.0 주문 수정(PATCH) 확인(사용자) · #197 · #208(DB 이력 확인 선행) · #202 · #209.

**2026-11-17 · 하네스 세팅 · 프로젝트 분석 — 코드 변경 0 · 실데이터 영향 없음.** pleiades 를 참고해 `.claude/` 하네스 구성(규칙 `workflow.md`·`data-safety.md` · 훅 `safety_guard.py` · 스킬 6 · 에이전트 3) · **리뷰를 pleiades 방식으로 전환**(사전 `code-reviewer` 에이전트 → GitHub Codex bot · codex-cli 미사용 · 사용자 결정) · CLAUDE.md 개요를 TS 모노레포로 교체 · 프로젝트 분석(로컬 전용 `docs/research/project-analysis.md` · 미추적 — 테스트 통과 · 타입체크·lint 전 패키지 실패 · Prisma 마이그레이션 루트 7/core 6 이원화 · 보안 항목은 문서에만). `.claude/` 추적 시작(`settings.local.json` 만 제외 · 이슈 #192). 인계 `docs/handoff/2026-11-17-harness-setup-analysis.md`. 다음 = **#192 PR 머지(사용자)** · 분석 문서 3절 보안 항목 착수 · 실제 DB `_prisma_migrations` 확인(사용자) · 검증 체계 복구.

## Development Workflow

### 브랜치 전략

```
main (production)     ←─── 릴리즈 버전, 태그 생성
  │
  │  ↑ PR (릴리즈)     ↓ 핫픽스 머지
  │
dev (development)     ←─── 개발 기본 브랜치
  │
  │  ↑ PR (피쳐)
  │
feature/*             ←─── 피쳐 브랜치 (dev base)
hotfix/*              ←─── 핫픽스 브랜치 (main base)
```

#### 핵심 규칙
- **개발 기본 브랜치**: `dev`
- ⚠️ **피쳐는 반드시 `dev`를 base로 생성** - main으로 직접 머지되는 피쳐 브랜치 금지
- **핫픽스만 `main`을 base로 생성** 가능
- **`main` 브랜치 직접 커밋 금지** - 반드시 PR을 통해서만 변경

#### 브랜치 네이밍
- 피쳐: `feature/issue-{번호}-{설명}` (예: `feature/issue-155-claim-db-only`)
- 핫픽스: `hotfix/issue-{번호}-{설명}` (예: `hotfix/issue-160-login-fix`)
- 릴리즈: `release/v{버전}` (예: `release/v1.0.0`) - 필요시 사용

#### PR 머지 방식

| 머지 경로 | 권장 방식 | 이유 |
|-----------|-----------|------|
| `feature/*` → `dev` | **Squash and Merge** | 피쳐 브랜치는 머지 후 삭제, 깔끔한 히스토리 |
| `dev` → `main` | **Create a merge commit** | 양 브랜치 유지, main↔dev 동기화 용이 |
| `hotfix/*` → `main` | **Create a merge commit** | 이후 main → dev 동기화 필요 |

⚠️ **주의**: `dev` → `main` 머지 시 Squash Merge를 사용하면:
- main에 새 커밋 생성 → dev와 커밋 히스토리 분리
- 이후 핫픽스 시 `main` → `dev` 머지가 복잡해짐
- dev를 리셋하거나 별도 동기화 작업 필요

### 버전 관리

#### 버전 넘버링 규칙
- **형식**: `v{메이저}.{마이너}.{패치}` (Semantic Versioning)
- **초기 버전**: `v1.0.0`
- **예시**: v1.0.0, v1.1.0, v1.1.1, v2.0.0

| 버전 타입 | 변경 시점 | 예시 |
|-----------|----------|------|
| **메이저** | 호환성이 깨지는 대규모 변경 | v1.0.0 → v2.0.0 |
| **마이너** | 하위 호환 가능한 새 기능 추가 | v1.0.0 → v1.1.0 |
| **패치** | 버그 수정, 핫픽스 | v1.0.0 → v1.0.1 |

### 릴리즈 프로세스

#### 피쳐 릴리즈 (일반 개발)

```
1. 피쳐 개발
   feature/* ──PR──→ dev (머지)

2. 릴리즈 준비
   dev ──PR──→ main (릴리즈 PR 생성)

3. 릴리즈 완료
   main 머지 → 버전 태그 생성 (v1.x.x)
```

**상세 절차:**
1. `dev`에서 피쳐 브랜치 생성 → 개발 → PR → `dev` 머지
2. 릴리즈 시점에 `dev` → `main` PR 생성
3. PR 리뷰 후 `main`에 머지
4. `main`에서 버전 태그 생성: `git tag v1.x.x && git push origin v1.x.x`

#### 핫픽스 릴리즈 (긴급 수정)

```
1. 핫픽스 개발
   main ──branch──→ hotfix/* ──PR──→ main (머지)

2. 패치 버전 태그
   main 머지 → 버전 태그 생성 (v1.0.x)

3. dev 동기화 (필수!)
   main ──merge──→ dev
```

**상세 절차:**
1. `main`에서 핫픽스 브랜치 생성: `git checkout -b hotfix/issue-xxx main`
2. 버그 수정 → PR → `main` 머지
3. `main`에서 패치 버전 태그 생성: `git tag v1.0.x && git push origin v1.0.x`
4. ⚠️ **필수**: `main` 변경사항을 `dev`에 머지하여 동기화
   ```bash
   git checkout dev
   git merge main
   git push origin dev
   ```

### 태그 생성 방법

```bash
# 태그 생성
git tag -a v1.0.0 -m "Release v1.0.0: 초기 정식 릴리즈"

# 원격에 푸시
git push origin v1.0.0

# 모든 태그 푸시
git push origin --tags
```

### GitHub Release 생성 (선택)

```bash
# GitHub CLI로 릴리즈 생성
gh release create v1.0.0 --title "v1.0.0" --notes "## 주요 변경사항
- 기능 A 추가
- 버그 B 수정"
```

### 이슈 및 PR 관리
- **모든 작업은 GitHub 이슈로 먼저 생성** — 이슈와 PR 은 1:1 (예외: 릴리즈 PR · 핫픽스 dev 동기화)
- 진행사항은 이슈에서 트래킹 및 관리
- **피쳐 머지는 반드시 PR을 통해서만 진행**
- ⚠️ **PR 머지는 사용자가 직접 수행** — Claude Code는 PR 생성까지만 담당 (훅이 `gh pr merge` 를 막는다)
- 이슈·PR 본문은 Claude Code 가 작성한다 (형식: `.claude/rules/workflow.md` 2·7-2절)

### 코드 리뷰 프로세스 (pleiades 방식 · 2026-11-17 사용자 결정)

리뷰는 **PR 오픈을 사이에 두고 두 단계**다. 상세 절차는 `.claude/rules/workflow.md` 7절이 정본이다.

1. **사전 리뷰 (PR 오픈 전)** — `pr-review-toolkit:code-reviewer` 에이전트. 척도는 **단어**(critical / major / info).
   critical·major 는 반드시 수정 → 검증 재통과 후 PR 오픈. 문서·하네스·소규모 config 는 self-review 경로.
2. **GitHub Codex bot (PR 오픈 후)** — 자동 실행. 척도는 **`P0` 가 최고**. P0·P1 반드시 수정 → 재검증 →
   `@codex review` 1회. P2 이하는 후속 이슈. 대응 절차는 `codex-loop` 스킬.
3. **codex-cli MCP 는 원칙적으로 쓰지 않는다** — GitHub Codex bot 과 같은 쿼터를 쓴다. 사용자가 요청할 때만.
4. **테스트·빌드는 Claude Code 가 실행**하고(검증 표: workflow 6절) 결과를 PR 본문 `## 코드 리뷰 결과` 에 기록한다
   — 리뷰 방식 · 라운드별 지적과 처리 · 미반영 사유 · 회귀 테스트.

> 이전 방식(codex-cli 가 이슈·PR 본문 작성과 리뷰를 맡던 역할 분담)은 위로 대체됐다. 과거 PR 의
> "codex-cli N차 리뷰" 기록은 이력으로 남는다.

### 하네스 (`.claude/`)

| 종류 | 이름 | 용도 |
|---|---|---|
| 규칙 | `rules/workflow.md` · `rules/data-safety.md` | 개발 단계·검증 표·리뷰 게이트 · 실데이터(시트·DB·비밀) 보호 |
| 훅 | `hooks/safety_guard.py` | Bash 사전 차단 — main 직접 커밋/push · force push · `--tags` · `gh pr merge` · prisma reset · 시트 변경 스크립트 · 비밀 출력 |
| 스킬 | `tangerine-orchestrator` · `tangerine-resume` · `tangerine-handoff` · `codex-loop` · `orphan-check` · `release` | 기능 파이프라인 · 세션 재개/인계 · 봇 리뷰 대응 · squash 후 orphan · 릴리즈/핫픽스 |
| 에이전트 | `codebase-surveyor` · `verifier` · `data-safety-auditor` | 실측(읽기 전용) · 검증 실행 · 데이터 손실 반증 |

**세션 경계:** 시작 = `/tangerine-resume`(인계 상태 복원 → 브리핑) · 종료 = `/tangerine-handoff`(인계 노트 `docs/handoff/` + 위 "현재 상태" 문단 + 커밋).

## 프로젝트 개요

myTangerine 은 구글 폼으로 들어오는 감귤 주문(스프레드시트 "감귤 주문서(응답)")을 PostgreSQL 로 동기화하고,
주문 상태 관리·배송 라벨·PDF/Excel 보고서·통계·배송사고(claim) 처리를 제공하는 **pnpm TypeScript 모노레포**입니다.
분석 기준선과 위험 목록은 `docs/research/project-analysis.md` (2026-11-17 · **로컬 전용 — 공개 저장소라 gitignore**. 보안 위험의 위치·재현 방법을 이슈·PR·커밋에 적지 않는다).

## 패키지 구조

| 패키지 | 역할 |
|---|---|
| `packages/core` (`@mytangerine/core`) | 도메인 타입 · `SheetService` · `DatabaseService` · `HybridDataService` · `SyncEngine` · 분산 락 · 변경 이력 · 포매터. tsup 으로 빌드되어 다른 패키지가 dist 를 소비 |
| `packages/api` (`@mytangerine/api`) | Fastify REST API (`/api/orders/*` · `/api/labels/*` · `/api/sync/*` · `/docs`) |
| `packages/web` (`@mytangerine/web`) | Next.js 16 관리 화면 (dashboard · orders · labels · stats) |
| `packages/sync-service` | node-cron 으로 Sheets → DB 증분 동기화 |
| `prisma/` · `prisma.config.ts` | Prisma 스키마·마이그레이션 **정본(하나)** — 운영 DB 이력과 일치 · generator `output` 미지정 (#208). Prisma 7: 접속 주소는 `prisma.config.ts` · client 는 core `createPrismaClient`(드라이버 어댑터) 로만 만든다 (#241 · `.claude/rules/data-safety.md`) |

`src/*.py` · `getLabel.py` 는 초기 Python 버전으로, 현재 코드에서 참조하지 않는 레거시입니다.

## 데이터 흐름

```
구글 폼 → 시트 "감귤 주문서(응답)"
          │  sync-service (cron, 기본 1분) / POST /api/sync[/full]
          ▼
     SyncEngine: 시트 행 → DB upsert (키 sheetRowNumber) → 시트에 DB_SYNC_STATUS/AT/ID 기록
          ▼
     PostgreSQL ←── HybridDataService (DATA_SOURCE = sheets | database | hybrid)
          ▲              hybrid: DB 우선 읽기, 쓰기는 DB → 시트 순차
     api (Fastify) ←── web (Next.js, TanStack Query)
```

주문 상태: `신규주문` → `입금확인` → `배송완료` (시트 `비고` 컬럼). 배송사고(claim) 주문은 DB 전용(`sheetRowNumber` 없음, `originalRowNumber` 로 원본 참조).

## 실행·검증

Node **24**(`.nvmrc` · 요구 `>=20.19.0` — Fastify 5) · 운영 서버 Node 24.12 · pnpm 10.

```bash
pnpm install                                  # postinstall 이 prisma generate
pnpm --filter @mytangerine/api dev            # API (PORT)
pnpm --filter @mytangerine/web dev            # 웹
pnpm --filter @mytangerine/sync-service dev   # 동기화 — 실제 시트에 쓴다 (data-safety S-2)
```
패키지별 lint·타입·테스트·빌드 명령은 `.claude/rules/workflow.md` 6절 표를 쓴다.

**배포:** GitHub Release 발행 = 서버 자동 배포(Actions → ssh forced command → `deploy/release-inplace.sh`). 스키마 변경 릴리즈는 `--prerelease`(수동) · 서버 조치 필요 시 `--draft`. 런북 `docs/runbooks/auto-deploy.md`.

**시트 · 동기화 운영:** 응답 시트에서 주문 행을 지우거나 손으로 넣지 않는다(폼이 끼워 넣어 행이 밀린다 — 2026-11-19 사고). 어긋나면 앱이 쓰지 않고 멈추고 `#hermes` 로 알린다. 신호 · 진단 · 정리 절차는 런북 `docs/runbooks/sheet-sync-operations.md`.

## 초기 설정

1. `cp .env.example .env` 후 값 입력 (`DATABASE_URL` · `SPREADSHEET_ID` · `GOOGLE_CREDENTIALS_FILE` · `DATA_SOURCE` · `API_SECRET_KEY` · `DEFAULT_SENDER_*` · `NEXT_PUBLIC_API_BASE_URL`)
2. 서비스 계정 JSON 키를 프로젝트 루트 `credentials.json` 으로 저장 (`credentials.json.example` 참고) — 시트에 접근 권한 부여
3. DB: `docs/DATABASE_SETUP_QUICKSTART.md` (마이그레이션은 루트 `prisma/` 하나 — data-safety 참고)

## 한국어 컬럼명 (시트 계약 — 바꾸지 않는다 · data-safety S-7)

타임스탬프 · 비고(상태) · 보내는분 · 받으실분 · 상품 선택 · 5kg 수량 · 10kg 수량 · 송장번호 · 삭제됨 · 주문유형(선물/판매/배송사고) · DB_SYNC_STATUS/AT/ID.
타임스탬프는 한국어 오전/오후 표기이며 `parseKoreanTimestamp` 로 파싱합니다.
