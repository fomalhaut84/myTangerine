---
name: tangerine-handoff
description: myTangerine 세션을 마무리하며 docs/handoff/YYYY-MM-DD-<주제>.md 인계 노트를 남기고 CLAUDE.md "현재 상태" 절·메모리 색인을 동기화하는 절차. "정리하자", "마무리해줘", "인계 노트", "오늘은 여기까지", "세션 정리", "handoff" 요청 시 사용. 세션에서 결정·문서 변경·미완료 작업이 있었다면 종료 전 반드시 사용한다.
---

# tangerine-handoff — 세션 인계

> 출처: pleiades `.claude/skills/pleiades-handoff`. 짝은 `tangerine-resume` — 이쪽이 쓴 것을 다음 세션이 읽는다.

인계 노트의 목적은 "무엇을 짜다 말았나" 보다 **"무엇이 결정됐고 무엇이 안 됐나"** 를 남기는 것이다.
세션 사이에 사용자가 머지·배포·시트 작업을 하므로, 노트는 **관측한 시점**을 함께 적는다.

## 1. 세션 중 변경분 확인

```bash
cd ~/workspace/myTangerine
git status -sb && git stash list && git log --oneline origin/dev -5    # head 로 자르지 않는다 — 미커밋·untracked·stash 가 인계 대상이다
echo "dev=$(git rev-parse --short origin/dev) main=$(git rev-parse --short origin/main) tag=$(git describe --tags --abbrev=0 origin/main 2>/dev/null)"
gh pr list --state open --json number,title,author -q '.[] | select(.author.login != "app/dependabot") | "#\(.number) \(.title)"'
```

**실데이터 영향을 노트 첫 블록에 적는다** — 시트 쓰기(스크립트 · 수동 테스트 · sync 실행) · DB 마이그레이션 적용 · `DATA_SOURCE` 변경 · 비밀·`.env` 변경 · 배포.
정상값은 **"없음 — 코드·문서만"** 이다. 있으면 무엇을 했고 되돌릴 수 없는 흔적이 무엇인지 그대로 적는다(`.claude/rules/data-safety.md`).
로컬에서 띄운 프로세스(api · web · sync-service dev 서버)가 남아 있으면 적는다 — **sync-service 는 실제 시트에 쓴다.**

## 2. 인계 노트 작성 — `docs/handoff/YYYY-MM-DD-<주제>.md`

직전 노트가 형식 참고용이다. 같은 날 두 번째면 `<주제>` 로 구분한다.

```markdown
# 인계 노트 — YYYY-MM-DD, <주제>

직전 노트: `<파일명 | 없음 (첫 노트)>`. 이 노트가 최신이다.

**실데이터 영향:** <없음 — 코드·문서만 | 항목별>
**관측 시점:** dev `<sha7>` · main `<sha7>` (`<tag>`) · 열린 PR <번호 | 0> (dependabot 제외) · CI(dev) <결과>

## 이 세션에서 한 일
1. <번호 목록 — 이슈 #N → PR #M · 핵심 판단 한 줄>

## 결정된 것
| 결정 | 근거 (누가 · 언제) |
|---|---|

<결정 때문에 바뀐 판단이 있으면 함께>

## 결정되지 않은 것
- <미결 질문> — 누가 · 언제까지 답해야 다음이 풀리는지

## 다음 세션의 첫 액션 후보
1. <우선순위 순 — 범위 · 선행 조건 · 데이터 영향 · 되돌리는 법>

## 주의사항
<다음 세션이 모르면 사고 나는 것 — 아래 3절 목록>

## 재현이 필요한 절차
<이 세션에서 막혔던 절차와 해결 명령 (없으면 절 생략)>
```

## 3. 주의사항에 반드시 넣을 것

- **실데이터 영향**과 남은 로컬 프로세스·로컬 DB 상태
- **열린 PR 의 남은 게이트** — 봇 미반영 P0/P1 · 봇 미게시 컷오프 시각 · 사용자 머지 대기
- **미적용·미확인 마이그레이션** — 어느 스키마(루트/core)에 넣었는지(`data-safety.md` 스키마 두 벌)
- **이번 세션에서 정정된 기록** — 옛 문서·이전 노트를 그대로 믿으면 안 되는 지점
- stale 한 것으로 확인된 표기(README · ROADMAP · 이슈 상태 등)
- 사용자에게 넘긴 수동 작업(시트 컬럼 추가 · 서버 `.env` · 배포)과 그 결과를 아직 못 들었는지

## 4. 동기화

인계 노트만 쓰고 끝내면 다음 세션이 옛 지도를 본다. 함께 맞춘다:

| 대상 | 갱신할 것 |
|---|---|
| `CLAUDE.md` **"## 현재 상태"** | 절 **맨 위에** 이 세션 문단 1개를 추가한다(옛 문단은 지우지 않는다 — 이력). 형식: `**YYYY-MM-DD · <주제>.** <한 일 요약 — 이슈·PR 번호> · <실데이터 영향 ≠ 없음이면 명시> · 인계 \`docs/handoff/<파일>\`. 다음 = **<첫 액션 후보>** · <다음 후보들>.` |
| `CLAUDE.md` 나머지 | 구조·명령·규칙이 바뀌었으면 해당 절 |
| `docs/research/project-analysis.md` | 위험 항목을 해결했거나 새로 발견했으면 그 행 |
| 메모리 | `MEMORY.md` 는 색인일 뿐. 정본은 `docs/`. 문서 내용을 복사하지 않는다 — 비자명한 사용자 결정·선호만 |

`CLAUDE.md` 상태 문단이 10개를 넘으면 오래된 것부터 인계 노트 링크 한 줄로 줄인다.

## 5. 커밋

```
docs(handoff): <주제> 세션 인계 노트

<무엇을 했고 무엇이 결정됐는지 3~5줄>
실데이터 영향: <없음 | 요약>
```

**커밋·PR 은 `.claude/rules/workflow.md` 를 따른다** — `main` 직접 커밋 금지(훅 W-1) · 머지는 사용자.
- 진행 중 피쳐 브랜치가 있고 그 작업의 인계면 → 그 브랜치에 얹는다
- 아니면 → 이슈 → `feature/issue-<N>-handoff-<주제>`(base `dev`) → 문서뿐이라 self-review 경로(7-0) → PR
- 사용자가 커밋을 원하지 않으면 노트만 남기고 미커밋 상태를 알린다

## 하지 않는 것

- 결정되지 않은 것을 결정된 것처럼 쓰지 않는다 — 다음 세션이 그것을 전제로 움직인다
- 고객 개인정보(이름 · 주소 · 전화 · 주문 내용)를 노트·커밋 메시지에 옮기지 않는다 — 행 번호·주문 ID 로만 가리킨다
- 비밀 값(`.env` · 키)을 적지 않는다 — 키 이름만
