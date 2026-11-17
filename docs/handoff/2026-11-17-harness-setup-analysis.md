# 인계 노트 — 2026-11-17, 하네스 세팅 · 프로젝트 분석

직전 노트: 없음 (첫 노트). 이 노트가 최신이다.

**실데이터 영향:** 없음 — 코드·문서·하네스만. 시트 쓰기 0 · DB 접속 0 · 배포 0.
로컬에서 한 것: `npx prisma generate`(루트 `node_modules/.prisma` 재생성 · DB 무접촉) · 패키지 빌드 산출물(`dist` · `.next`) 재생성. 띄운 프로세스 없음.
**관측 시점:** dev `5a684a1` = main `5a684a1` (`v1.1.0`) · 열린 PR 0 (dependabot 19 제외) · CI(dev) 마지막 실행 `Security Audit` failure.

## 이 세션에서 한 일

1. **하네스 구성** (`.claude/` — pleiades 참고 · 이 저장소에 맞게 새로 씀)
   - 규칙: `rules/workflow.md`(단계 · 패키지별 검증 표 · 2단계 리뷰) · `rules/data-safety.md`(S-1~S-7 실데이터 보호 · Prisma 두 벌 주의)
   - 훅: `hooks/safety_guard.py` + 테스트(8 테스트 · 36 케이스 통과) · `settings.json` 에 PreToolUse(Bash) 등록 · `.env`·`credentials.json` Read deny
   - 스킬: `tangerine-orchestrator` · `tangerine-resume` · `tangerine-handoff` · `codex-loop` · `orphan-check` · `release`
   - 에이전트: `codebase-surveyor` · `verifier` · `data-safety-auditor`
2. **CLAUDE.md 갱신** — 리뷰 절차 교체 · 하네스 표 · "현재 상태" 절 신설 · Python 시절 개요/아키텍처/의존성을 TS 모노레포 설명으로 교체
3. **프로젝트 분석** — `docs/research/project-analysis.md` (영역별 읽기 전용 에이전트 3 + 로컬 검증 실측 · 핵심 주장은 직접 재확인)

## 결정된 것

| 결정 | 근거 |
|---|---|
| 리뷰는 pleiades 방식 — PR 전 `pr-review-toolkit:code-reviewer`(critical/major/info) · PR 후 GitHub Codex bot(P0 최고) · codex-cli MCP 는 사용자 요청 시에만 | 사용자 2026-11-17 ("플레이아데스 방식을 따를게") |
| 이슈·PR 본문은 Claude 가 작성 (codex-cli 작성 규칙 폐지) | 위 결정의 연장으로 Claude 가 적용 — **사용자가 본문만 codex-cli 로 되돌리길 원하면 바꾼다** |
| `.claude/` 를 git 으로 추적(`settings.local.json` 만 제외) — 이슈 #192 · `feature/issue-192-claude-harness` PR | 사용자 2026-11-17 |
| resume/handoff 는 pleiades 형식 — `docs/handoff/` 노트 체인 + CLAUDE.md "현재 상태" 문단 | 사용자 2026-11-17 |

## 결정되지 않은 것

- 실제 운영 DB 가 루트·core 중 어느 마이그레이션 이력을 따르는지 — `_prisma_migrations` 조회는 사용자가 한다
- 운영 배포 방식(PM2 등) — 저장소에 설정 없음

## 다음 세션의 첫 액션 후보

1. **#192 PR 확인** — 사용자 머지 대기 · 봇 리뷰 결과 대응(`codex-loop`) · 머지 뒤 `orphan-check`
2. **API 인증** — orders·labels 라우트 인증 + CORS 허용 목록 + rate limit · web sync 프록시 호출자 인증 (보안 · `tangerine-orchestrator` · web 이 API 를 직접 부르는 구조라 인증 방식 설계가 먼저)
3. **Prisma 단일화** — 사용자 DB 확인 → 정본 스키마 결정 (데이터 · `data-safety-auditor` 필수)
4. **검증 복구** — core `dts` · TS 오류 8 · api eslint 설정 · `next lint` 교체 · CI 에 type-check·web·sync-service

## 주의사항

- **타입체크·lint 는 현재 전 패키지 실패가 기준선이다** — 새 작업의 검증에서 "기존 실패" 와 "내가 만든 실패" 를 구분해 보고한다(분석 2절 표)
- core 가 읽는 Prisma client(`node_modules/.pnpm/@prisma+client@*/node_modules/.prisma`)는 2025-12-22 생성본이라 `OrderChangeLog` 가 없다. 루트 `prisma generate` 로는 고쳐지지 않는다. 운영 런타임 영향은 **미확인**
- `.claude/settings.local.json` 은 `gh pr merge:*` 를 허용하지만 훅이 막는다(W-4) — 의도된 것
- 훅·스킬·에이전트는 세션 재시작 뒤 확실히 적용된다
- 정정된 기록: 이전 CLAUDE.md 의 "Python 기반" 설명 · "codex-cli 가 리뷰" 규칙은 더 이상 유효하지 않다. README(Next 14 · 다크모드 지원) · ROADMAP(2025-12-19 기준)도 낡았다
- 보안 이슈 #172 열림 · dependabot PR 19 (fastify 5 ×3 · next ×2 중복)
