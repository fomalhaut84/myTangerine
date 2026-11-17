---
name: tangerine-resume
description: myTangerine 새 세션 시작 시 인계 상태를 로드하고 브리핑한다. 트리거 - 새 세션 첫 발화가 명시적 작업 지시가 아닐 때, "이어서 진행", "지금 상황", "어디까지 했지", "뭐부터 하면 돼", "resume", "재개". 상태 복원과 브리핑까지가 범위이고, 실제 작업은 tangerine-orchestrator(기능) · codex-loop(리뷰) · release(릴리즈)로 넘긴다.
---

# tangerine-resume — 재개 브리핑

> 출처: pleiades `.claude/skills/pleiades-resume`. 짝은 `tangerine-handoff` — 그쪽이 쓰는 것(인계 노트 · `CLAUDE.md` 상태 절)을 이쪽이 읽는다.

재개는 "무엇을 짜다 말았나" 만이 아니라 **"무엇이 결정됐고 무엇이 안 됐나 · 실데이터에 무엇이 남았나"** 를 복원하는 일이다.

## 사용 X

- 사용자가 명확한 작업을 지시한 경우 → `tangerine-orchestrator`
- 단순 질문 응답

## Step 1 — 인계 소스 로드 (병렬)

```
Read: CLAUDE.md 의 "## 현재 상태" 절 — 맨 위 문단이 최신 (세션당 한 문단 · "다음 =" 이 직전 세션의 제안)
Bash: ls -t docs/handoff/ | head -3 && git log --oneline -5 origin/dev
Read: docs/handoff/ 의 가장 최근 파일 — "실데이터 영향" · "결정되지 않은 것" · "다음 세션 첫 액션 후보" · "주의사항"
```

`docs/research/project-analysis.md` 는 위험·우선순위가 실제로 필요할 때만 읽는다(재분석 전에 반드시 이 파일부터).
인계 노트가 없으면(첫 세션) Step 2 만으로 브리핑하고 그 사실을 적는다.

## Step 2 — 현재 상태 (인계 노트보다 이것을 신뢰한다)

```bash
cd ~/workspace/myTangerine
git fetch -q origin && git status -sb | head -3 && git stash list | head -3
echo "dev=$(git rev-parse --short origin/dev) main=$(git rev-parse --short origin/main) tag=$(git describe --tags --abbrev=0 origin/main 2>/dev/null)"
echo "main 에만 있는 커밋: $(git rev-list --count origin/dev..origin/main)"   # 0 이 아니면 핫픽스 dev 동기화 누락
echo "릴리즈 안 된 dev 커밋: $(git rev-list --count origin/main..origin/dev)"
gh pr list --state open --json number,title,author -q '.[] | select(.author.login != "app/dependabot") | "#\(.number) \(.title)"'
echo "dependabot PR: $(gh pr list --state open --author app/dependabot --json number -q length)"
gh issue list --state open --limit 20 --json number,title,labels -q '.[] | "#\(.number) \(.title) [\([.labels[].name]|join(","))]"'
echo "로컬 브랜치: $(git branch | wc -l | tr -d ' ') · 원격 삭제됨([gone]): $(git branch -vv | grep -c ': gone]')"
git branch -vv | grep ': gone]' | awk '{print $1}' | head -5      # 머지된 브랜치 → orphan-check 후보 (이름 열거는 5개까지)
gh run list --branch dev --limit 1 --json conclusion,displayTitle -q '.[] | "CI(dev): \(.conclusion) — \(.displayTitle)"'
```

- **인계 노트와 다르면 현재 상태가 이긴다** — 세션 사이에 사용자가 머지·배포·시트 작업을 했을 수 있다. 다른 점은 브리핑에 적는다
- 인계 노트 "주의사항" 의 열린 항목(봇 미반영 P1 · 미적용 마이그레이션 · 사용자 확인 대기)은 지금도 열려 있는지 확인한다
- `main 에만 있는 커밋` 이 0 이 아니면 **브리핑 첫 줄**에 적는다(`release` 스킬 핫픽스 5번)
- 보안 이슈(`security` 라벨)가 새로 열렸으면 첫 줄에 적는다

## Step 3 — 브리핑 (3문단 이내)

```
## myTangerine 상태 (YYYY-MM-DD)

**저장소:** 현재 <브랜치> {clean/dirty} · dev <sha7> · main <sha7>(<tag>) · 릴리즈 대기 dev 커밋 N · 동기화 {OK | main 이 N 앞섬}
**열린 것:** 내 PR {번호·제목 | 없음} · dependabot N · CI(dev) {success/failure}
**직전 세션 (<노트 파일명>):** <한 줄 — 한 일 · 실데이터 영향> · 미결: <결정되지 않은 것 중 다음을 막는 것>

**다음 후보 액션:**
1. {가장 자연스러운 다음 스텝 — 범위 · 데이터 영향 · 되돌리는 법}
2. {대안}

어떤 방향으로 갈까?
```

## Step 4 — 진행

방향이 정해지면 넘긴다: 기능·수정 → `tangerine-orchestrator` · 봇 리뷰 → `codex-loop` · 릴리즈·핫픽스 → `release` · 머지 뒤 정리 → `orphan-check`.
이 스킬의 범위는 브리핑까지다.

## 원칙

- **실측값은 추정하지 않는다.** 숫자가 필요하면 `codebase-surveyor` 로 측정한다
- **실데이터(시트·DB) 작업은 사용자 확인 후** — `.claude/rules/data-safety.md`
- 결정되지 않은 것을 결정된 것처럼 말하지 않는다

## 세션 종료 시

`tangerine-handoff` 스킬을 사용한다.
