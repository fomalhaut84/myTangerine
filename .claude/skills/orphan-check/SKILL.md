---
name: orphan-check
description: Squash merge 뒤 로컬 브랜치에 남은 커밋이 dev 에 반영되지 않은 상태(orphan)를 감지·회수한다. "머지 완료" 알림 직후 자동으로, "이 커밋 dev 에 있어?", "orphan 있어?", 머지된 브랜치에 커밋을 더 push 하려 할 때 사용.
---

# orphan-check

> 출처: pleiades `.claude/skills/orphan-check`(판정 로직 정정판 — 타임스탬프가 아니라 **머지된 PR head** 기준). base 는 피쳐 `dev` · 핫픽스 `main`.

Squash merge 는 PR 머지 시점의 head 까지만 dev 로 압축한다. 그 뒤 같은 브랜치에 push 한 커밋은 dev 에 없다.

## Step 1 — 상태

```bash
git fetch origin
CURRENT=$(git branch --show-current); BASE=dev    # hotfix/* 면 BASE=main
gh pr list --head "$CURRENT" --state merged --limit 1 --json number,mergedAt,headRefOid
MERGED_HEAD=$(gh pr list --head "$CURRENT" --state merged --limit 1 --json headRefOid -q '.[0].headRefOid')
```

- `MERGED_HEAD` 가 40자 SHA 가 아니면 → **판정 불가** (조회 실패 · 머지된 PR 없음). 브랜치를 지우지 않고 보고한다
- `git cat-file -e "$MERGED_HEAD^{commit}"` 실패 → `git fetch origin` 뒤 재시도, 그래도 없으면 판정 불가

## Step 2 — 판정

```bash
git log --oneline "$MERGED_HEAD..$CURRENT"      # 비어 있으면 orphan 없음
```

| 결과 | 다음 |
|---|---|
| 비어 있음 | orphan 없음 → `git checkout dev && git pull && git branch -D "$CURRENT"` (squash 라 `-d` 는 거부된다 — 판정이 끝났으므로 `-D`) |
| 커밋 있음 | Step 3 |

## Step 3 — 회수

orphan 커밋 범위만 옮긴다(브랜치 전체 diff 를 쓰지 않는다 — 이미 dev 에 있는 변경이 중복된다):
```bash
git diff --stat "$MERGED_HEAD" "$CURRENT"       # 사용자에게 보고
git checkout dev && git pull
git checkout -b feature/issue-<N>-followup
git cherry-pick "$MERGED_HEAD..$CURRENT"
```
충돌하면 멈추고 보고한다. 이슈가 닫혔으면 새 이슈를 만들거나 원 이슈를 다시 연다(1:1 규칙). 이후 workflow 6절 → 7절.
