# 개발 워크플로우

모든 작업은 이 워크플로우를 따른다. 단계를 건너뛰지 않는다.

> **출처.** 브랜치·릴리즈·역할 분담은 `CLAUDE.md` 가 정본이고, 이 파일은 그것을 **실행 절차**로 옮긴 것이다.
> 구조(단계 표 · 검증 표 · 리뷰 게이트 · 심각도 척도 분리)는 이웃 저장소 pleiades `.claude/rules/workflow.md` 를 참고했다.
> 둘이 어긋나면 `CLAUDE.md` 가 이긴다.

## 규칙 요약 (훅이 막는 것)

| ID | 규칙 | 훅 |
|---|---|---|
| W-1 | `main` 직접 커밋·push 금지 — PR 로만 | 차단 |
| W-2 | `main`·`dev` force push · 원격 브랜치 삭제 금지 | 차단 |
| W-3 | 태그는 하나씩(`git push origin vX.Y.Z`) · `--tags` 금지 | 차단 |
| W-4 | **PR 머지는 사용자가 직접** — `gh pr merge` 금지 | 차단 |

## 단계

### 1. 기획
요청 → 목적·범위·영향 패키지(core/api/web/sync-service)·데이터 영향(`data-safety.md` S-2·S-5·S-6·S-7) 정리 → **사용자 승인**.

### 2. GitHub 이슈
**모든 작업은 이슈가 먼저다.** 이슈 없이 작업 브랜치를 만들지 않는다 — 이슈와 PR 은 1:1(예외: 릴리즈 PR · 핫픽스 dev 동기화).
본문은 Claude 가 쓴다(목적 · 범위 · 데이터 영향 · 완료 조건). 등록은 `gh issue create`.

> **정정 (2026-11-17 · 사용자 결정).** 이전 규칙은 이슈·PR 본문과 코드 리뷰를 codex-cli(`mcp__codex-cli__codex`)에 맡겼다.
> 사용자가 **pleiades 방식**을 택했다 — 사전 리뷰는 로컬 에이전트, 오픈 후 리뷰는 GitHub Codex bot, 본문은 Claude.
> codex-cli 는 GitHub Codex bot 과 **같은 쿼터**를 쓰므로 원칙적으로 쓰지 않는다(7-4). 되돌리기: 문구 (**즉시**).

### 3. 브랜치

| 유형 | base | 이름 | PR 대상 | 머지 방식 |
|---|---|---|---|---|
| 피쳐·일반 수정 | `dev` | `feature/issue-{N}-{설명}` | `dev` | **Squash and Merge** |
| 핫픽스 | `main` | `hotfix/issue-{N}-{설명}` | `main` | **Create a merge commit** → 이후 `main` → `dev` 동기화 필수 |
| 릴리즈 | — | `dev` 그대로 | `main` | **Create a merge commit** (squash 금지) |

```bash
git checkout dev && git pull && git checkout -b feature/issue-<N>-<설명>
```

커밋: `<type>(<scope>): <설명> (#<N>)` — type 은 feat · fix · refactor · docs · test · chore · perf · ci. scope 는 패키지·도메인(core · api · web · sync · claim · labels …).

### 4. 구현 계획
변경 파일 · 순서 · 의존성 추가 여부 · 마이그레이션 여부 → **사용자 승인 후** 코딩. 새 기능·버그 수정은 테스트 먼저(RED → GREEN).

### 5. 개발
- 패키지 경계: `core`(도메인·서비스·Prisma) ← `api`(Fastify) ← `web`(Next.js) · `sync-service`(cron). 역방향 import 금지
- 스키마 변경은 `data-safety.md` *Prisma 스키마 — 정본 하나* 를 먼저 따른다

### 6. 검증 — 명령을 추측하지 말고 이 표를 쓴다

변경한 패키지 행을 전부 돌린다. **core 를 바꾸면 그것을 쓰는 api·web·sync-service 의 빌드도 돌린다**(core 는 tsup dist 로 소비된다).

| 패키지 | lint | 타입 | 테스트 | 빌드 |
|---|---|---|---|---|
| `@mytangerine/core` | `pnpm --filter @mytangerine/core lint` | `pnpm --filter @mytangerine/core type-check` | `pnpm --filter @mytangerine/core exec vitest run` | `pnpm --filter @mytangerine/core build` |
| `@mytangerine/api` | `pnpm --filter @mytangerine/api lint` | `pnpm --filter @mytangerine/api type-check` | `pnpm --filter @mytangerine/api exec vitest run` | `pnpm --filter @mytangerine/api build` |
| `@mytangerine/web` | `pnpm --filter @mytangerine/web lint` | (빌드가 타입체크) | `pnpm --filter @mytangerine/web test` | `pnpm --filter @mytangerine/web build` |
| `@mytangerine/sync-service` | 해당 없음(스크립트 없음) | `pnpm --filter @mytangerine/sync-service type-check` | 해당 없음(테스트 없음) | `pnpm --filter @mytangerine/sync-service build` |
| `.claude/hooks` | 해당 없음 | 해당 없음 | `python3 -m unittest discover -s .claude/hooks` | 해당 없음 |
| `deploy/` · `.github/workflows/deploy.yml` (#201) | 해당 없음 | `bash -n deploy/*.sh` | `python3 -m unittest discover -s deploy` (임시 git 저장소 + 가짜 pnpm·pm2·curl · 약 25초 · CI `deploy-scripts` job) | 해당 없음 |

- core·api 의 `test` 스크립트는 `vitest`(watch 기본)라 **`exec vitest run`** 으로 1회 실행한다
- 빌드는 `DATABASE_URL` 이 있어야 prisma generate 가 돈다(CI 는 더미 값 — S-4)
- CI(`.github/workflows/ci.yml`) 는 core·api 만 돌고 lint 는 `continue-on-error` 다 — **CI 통과가 web·sync-service 검증을 뜻하지 않는다**
- 전부 통과해야 다음 단계. 실패하면 고치고 다시. "해당 없음"은 사유와 함께 적는다 — 건너뛰기가 아니다

### 7. 코드 리뷰 + PR — 두 단계 (PR 오픈 전 로컬 · 오픈 후 봇)

> **심각도 척도가 둘이고 방향이 반대다.** 로컬 사전 리뷰는 **단어**(critical / major / info),
> GitHub Codex bot 은 **`P0` 가 최고**인 네이티브 척도를 쓴다. 섞거나 번역하지 않는다.

#### 7-0. 적용 조건

| 변경 성격 | 사전 리뷰(7-1) |
|---|---|
| 실행 코드(`packages/**/src` 로직) · API 계약(라우트·스키마) | **에이전트 필수** |
| 데이터 경계 — 시트 쓰기 · sync · `DATA_SOURCE` 분기 · Prisma 스키마/마이그레이션 · 상태 전이 | **에이전트 필수 + `data-safety-auditor`** |
| 보안 sensitive — 인증(`API_SECRET_KEY`) · 파일 업로드/내보내기 · 외부 프로세스 | **에이전트 필수** |
| 실행 코드 신규 3파일 이상 or 기존 파일 200 LOC 이상 변경 | **에이전트 필수** |
| config 소규모(`.github/**` · 의존성 패치 업데이트) · 문서(`*.md` · `docs/**`) · 하네스(`.claude/**`) | **self-review** |

필수 행이 하나라도 걸리면 필수다. self-review 도 6단계 검증은 필수이고, PR body 에 `self-review (변경 성격: <카테고리>)` 를 적는다.

#### 7-1. 로컬 사전 리뷰 (PR 오픈 전)

`pr-review-toolkit:code-reviewer` 에이전트 1회. 필수인 경우 **이 리뷰 없이 PR 을 열지 않는다.**

```
Agent(subagent_type="pr-review-toolkit:code-reviewer", prompt="""
Review branch <current> vs dev in /Users/sagan/workspace/myTangerine.
## Context      <1~3문장 — 이번 변경이 하는 일 · 데이터 영향>
## Focus files  <주요 파일>
## Severity     critical: 보안·데이터손실·크래시 / major: 로직·엣지케이스·성능 / info: 스타일·네이밍
## Output       각 이슈 severity + file:line + 설명 + fix. 최종 counts critical/major/info. 300자 이내 결론.
""")
```
- **critical · major**: 반드시 수정 → 6단계 재검증
- **info**: 저비용·명확한 것만 반영, 큰 리팩터는 후속 이슈
- 에러 처리·fallback 을 건드렸으면 `pr-review-toolkit:silent-failure-hunter` 를 함께 돌린다

#### 7-2. PR 생성 (봇 리뷰의 전제)

critical/major = 0 · 검증 재통과 뒤 연다. 본문은 Claude 가 쓴다.
- 필수 항목: 변경 요약 · `Closes #<N>` · 검증 체크리스트(6단계 표) · 데이터 영향(S-2·S-5·S-6·S-7 해당 여부 · 되돌리는 법) · **`## 코드 리뷰 결과`** 초안(`봇: 리뷰 대기`)
- `gh pr create --base dev` (핫픽스는 `--base main`) · push 는 `-u`
- 끝에 `🤖 Generated with [Claude Code](https://claude.com/claude-code)`

#### 7-3. GitHub Codex bot 리뷰 (PR 오픈 후)

PR 오픈 시 자동으로 돈다. **커밋마다 재실행되지 않는다** — `@codex review` 코멘트 때만. 대응 절차는 `codex-loop` 스킬.
- **P0·P1**: 반드시 수정 → ★ 6단계 재검증 + 회귀 테스트 1건 → 커밋 → `@codex review` **1회**
- **P2 이하**: 저비용·명확한 것만 반영, 나머지 후속 이슈. **재리뷰 요청하지 않는다**(쿼터)
- **봇이 안 오면**: 오픈(또는 마지막 요청) 후 30분 → `@codex review` 1회 → 다시 30분 → `봇: 미실행 (미게시 (오픈 HH:MM · 재요청 HH:MM), YYYY-MM-DD HH:MM)`. 에이전트 필수 경로는 7-1 결과가 최종 리뷰, self-review 경로는 봇을 기다리지 않는다. **`P0/P1 = 0/0` 으로 적지 않는다**
- 같은 영역에서 2회 이상 반복되면 스코프·설계 재점검 신호

#### 7-4. codex-cli MCP — 원칙적으로 쓰지 않는다

`mcp__codex-cli__codex` 는 GitHub Codex bot 과 **같은 쿼터**를 쓴다. 봇이 PR 오픈 때 이미 리뷰한다. 사용자가 명시적으로 요청할 때만 쓴다.

#### 7-5. PR body 확정

봇 통과 뒤 `## 코드 리뷰 결과` 를 확정한다(`gh pr edit --body` 는 **전체 교체** — 현재 body 를 받아 섹션만 바꿔 `--body-file` 로 넣는다):
- 리뷰 방식: `에이전트 사전 리뷰 N회 + Codex M회` 또는 `self-review + Codex M회`(**`only` 쓰지 않는다**)
- 라운드 요약: `1회차: major 2건 → 반영` · `봇 1회차: P1 1 · P2 2 → P1 반영, P2 1건 #<후속>`
- 최종: `✅ 코드 리뷰 통과 (사전 critical/major: 0건 · 봇 P0/P1: 0건 · 마지막 수정 후 검증 재통과)` — info·P2 이하는 실제 건수와 처리
- 회귀 테스트: 파일 목록 또는 `해당 없음 (<사유>)`

PR 링크를 사용자에게 알린다. **머지는 사용자가 직접 한다.**

### 8. 머지 완료 후

사용자가 "머지 완료"를 알리면:
```bash
git checkout dev && git pull
```
→ `orphan-check` 스킬(squash 뒤 남은 커밋 감지) → 이슈 코멘트·닫기(필요 시) → 로컬 브랜치 삭제 → 다음 작업 제안.

## 릴리즈·핫픽스

`release` 스킬을 쓴다. 요지: `dev` → `main` PR(merge commit) → 사용자 머지 → 부모 2개 확인 → 태그 하나 push → `gh release create`.

> **Release 발행 = 서버 배포 (#201 · 사용자 2026-11-17).** `gh release create` 는 Actions(`deploy.yml`)로 서버 자동 배포를 시작한다 — 별도 승인 없음.
> - 스키마·마이그레이션이 바뀐 릴리즈는 **`--prerelease`** 로 발행한다(자동 배포 건너뜀 → 런북 수동 절차). 스크립트도 그런 태그에서는 바꾸기 전에 멈춘다
> - 서버 조치(`.env` 새 키 · pm2 이름·포트)가 필요한 릴리즈는 **`--draft`** → 사용자 서버 조치 → GitHub 에서 Publish
> - 실패 시 자동 롤백 없음 — Actions 실행 요약의 판정 양식(`되돌리기:` 줄)을 사용자에게 전달한다. Claude 는 서버에 접속하지 않는다
> - 런북: `docs/runbooks/auto-deploy.md`
핫픽스는 `main` 머지·태그 뒤 **`main` → `dev` 동기화 필수**.
