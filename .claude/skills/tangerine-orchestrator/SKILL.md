---
name: tangerine-orchestrator
description: myTangerine 의 기능 개발·버그 수정을 이슈부터 PR 까지 에이전트 팀으로 조율하는 오케스트레이터. 실측(영향 범위) → 계획 승인 → TDD 구현 → 검증 → 데이터 안전 감사 → 사전 리뷰 → PR → 봇 리뷰. "이거 구현해줘", "기능 추가", "버그 고쳐줘", "이슈 #N 진행", "다시 실행", "보완", "부분만 다시" 요청 시 사용. 세션 재개 브리핑은 tangerine-resume, 마무리는 tangerine-handoff, 단순 질문·파일 하나 읽기는 직접 응답한다.
---

# tangerine-orchestrator — 기능 작업 조율

정본 절차는 `.claude/rules/workflow.md`(단계) 와 `.claude/rules/data-safety.md`(실데이터) 다. 이 스킬은 그것을 **누가 언제 하는지**로 옮긴다.

## 팀

| 에이전트 | 역할 | 쓰기 |
|---|---|---|
| `codebase-surveyor` | 영향 범위·현재 동작 실측 (파일:줄 근거) | 없음 |
| 메인 세션 | 계획 · 구현(TDD) · 커밋 · 이슈/PR 본문 | 저장소 |
| `verifier` | workflow 6절 검증 표 실행 | 없음 |
| `data-safety-auditor` | 시트·DB·sync·마이그레이션 반증 (7-0 데이터 경계 행일 때만) | 없음 |
| `pr-review-toolkit:code-reviewer` | 7-1 사전 리뷰 (critical/major/info) | 없음 |
| GitHub Codex bot | 7-3 PR 리뷰 (P0 최고) — `codex-loop` 스킬로 대응 | — |

독립적인 조사(예: api 라우트 조사 + web 화면 조사)는 surveyor 를 **한 메시지에 병렬로** 띄운다.

## Phase 0 — 상태 확인

```bash
git status -sb | head -3 && git log --oneline -3 && gh pr list --state open --author @me
```
dirty 하거나 `dev`·작업 브랜치가 아니면 **임의로 정리하지 않고** 사용자에게 보고한다.

| 상황 | 모드 |
|---|---|
| 새 요청 · 이슈 없음 | 초기 실행 — Phase 1 부터 |
| 이슈·브랜치 있음 + "보완/부분만" | 부분 재실행 — 해당 Phase 만 |
| PR 열림 + 봇 리뷰 링크 | `codex-loop` 로 넘긴다 |

## Phase 1 — 실측 (`codebase-surveyor`)
영향 패키지 · 호출 경로 · 기존 테스트 · `DATA_SOURCE` 분기 여부 · 시트 컬럼 의존을 뽑는다. `docs/research/measured-facts.md` 를 먼저 본다.
**가정을 뒤집는 사실**(예: 스키마 두 벌 · 모드별 다른 경로)이 나오면 Phase 2 계획에 반드시 반영한다.

## Phase 2 — 계획 + 승인
변경 파일 · 순서 · 테스트 계획 · 마이그레이션 · 데이터 영향(S-2·S-5·S-6·S-7) · 되돌리는 법을 제시한다.
**사용자 승인 전에는 코딩하지 않는다.** 미결 선택지가 있으면 `AskUserQuestion` 으로 묻고, 각 선택지에 "무엇이 달라지는지"를 적는다.

## Phase 3 — 이슈 · 브랜치
`gh issue create`(본문 Claude 작성) → `git checkout dev && git pull && git checkout -b feature/issue-<N>-<설명>`.

## Phase 4 — 구현 (TDD)
테스트 먼저(RED) → 최소 구현(GREEN) → 정리. 시트·Prisma 는 mock(S-4). 논리 단위마다 커밋 `<type>(<scope>): <설명> (#<N>)`.

## Phase 5 — 검증 (`verifier`)
실패하면 메인 세션이 고치고 다시 Phase 5. 통과 표를 PR 본문용으로 보관한다.

## Phase 6 — 감사 · 사전 리뷰 (병렬)
- 데이터 경계 행이면 `data-safety-auditor` — **정정(❌) 이 하나라도 있으면 Phase 4 로**
- 7-0 필수면 `pr-review-toolkit:code-reviewer` — critical/major 반영 → Phase 5 재통과
- 같은 지적이 3라운드를 넘으면 사용자에게 보고하고 스코프 축소를 제안한다

## Phase 7 — PR · 봇
`git push -u origin <branch>` → `gh pr create --base dev`(본문 workflow 7-2) → 봇 대응은 `codex-loop`.
PR 링크를 알리고 멈춘다. **머지는 사용자.** "머지 완료" → workflow 8절 + `orphan-check`.

## 에러 핸들링

| 상황 | 대응 |
|---|---|
| 훅 차단(safety_guard) | 우회 금지. 사유와 명령을 사용자에게 전달(`! <명령>`) |
| 구현 중 계획 밖 변경 필요 | **중단** 후 범위 재승인 |
| 검증이 기존(무관) 실패 | 재현 명령과 함께 보고, 별도 이슈 제안. 내 변경으로 덮지 않는다 |
| 실시트·실 DB 가 있어야 확인되는 동작 | 오프라인 테스트로 최대한 확인하고, 수동 확인 절차를 사용자에게 넘긴다 |
