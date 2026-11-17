---
name: release
description: myTangerine 릴리즈(dev → main PR · 태그 · GitHub Release)와 핫픽스(main base → main 머지 → dev 동기화) 절차. "릴리즈하자", "버전 올려", "태그 만들어", "v1.x.x", "핫픽스", "main 동기화" 요청 시 사용.
---

# release — 릴리즈·핫픽스

정본: `CLAUDE.md` 브랜치 전략·버전 관리·릴리즈 프로세스. 머지는 **사용자가 직접**(훅 W-4).

## 버전 정하기
```bash
git describe --tags --abbrev=0 origin/main
git log --oneline "$(git describe --tags --abbrev=0 origin/main)"..origin/dev
```
feat 포함 → minor · fix 만 → patch · 호환성 깨짐(시트 컬럼 계약 변경 · 서버 `.env` 필수 키 추가 · 마이그레이션 수동 조치) → major. 사용자에게 제안하고 확인받는다.

## 피쳐 릴리즈

```bash
: "${V:?V=vX.Y.Z 로 먼저 지정}"
gh pr create --base main --head dev --title "Release $V" --body-file "$SCRATCH/release.md"
```
- 본문: 포함 이슈·PR 목록(`Closes` 없음 — 릴리즈 PR 은 1:1 예외) · **배포 시 조치**(마이그레이션 · `.env` 키 · 시트 작업, 없으면 "없음")
- 봇 리뷰 게이트(workflow 7-3). 지적 수정은 `codex-loop` Step 5 — 릴리즈 PR 에 직접 커밋하지 않는다. 봇 미게시면 **회복까지 보류**
- 사용자에게: **"Create a merge commit" 으로 머지** (squash 금지 — main↔dev 히스토리가 갈라진다)

머지 확인 뒤:
```bash
git checkout main && git pull
git log -1 --format=%P | wc -w        # 2 여야 한다
git tag -a "$V" -m "Release $V: <요약>"
git push origin "$V"                  # --tags 금지 (W-3)
gh release create "$V" --title "$V" --notes-file "$SCRATCH/notes.md"   # ← 발행 즉시 서버 자동 배포 (#201)
#   스키마·마이그레이션 변경 → --prerelease (자동 배포 건너뜀 · 런북 수동 절차)
#   서버 .env 새 키 등 조치 필요 → --draft (사용자 조치 뒤 GitHub 에서 Publish)
git checkout dev
```
부모가 1개(squash 됨)면: `dev` 에서 `feature/issue-<N>-sync-main` → `git merge -s ours --no-ff origin/main` → PR(base dev, merge commit) 으로 히스토리 복구. 다음 릴리즈 전에 한다.

## 배포 확인 (발행 뒤)

```bash
gh run list --workflow deploy.yml --limit 1          # 상태
gh run view <run-id> --log | sed -n '/=== 판정 양식/,/=== 끝/p'
```
- `결과: 통과` / `이미 배포됨` → 사용자에게 보고하고 끝
- rc 1 → 서비스 그대로. `결과:` 줄 원인을 해결한 뒤 Actions 재실행
- rc 4 → **서비스가 불완전할 수 있다** — 판정 양식의 `되돌리기:` · `재시도:` 줄을 사용자에게 전달(서버 실행은 사용자 · 자동 롤백 없음)
- 런북: `docs/runbooks/auto-deploy.md`

## 핫픽스

1. 이슈 → `git checkout main && git pull && git checkout -b hotfix/issue-<N>-<설명>`
2. 수정 → workflow 6절 → **7-1 사전 리뷰 1회 (게이트 그대로 — critical/major 수정)**
3. `gh pr create --base main` → 봇 P0/P1 수정 → 사용자 **merge commit** 머지
4. 패치 태그 (위 태그 블록)
5. **dev 동기화 필수:** `git checkout dev && git pull && git merge origin/main` → 충돌 해결 → 6절 검증 → `git push origin dev`
   (dev 에 직접 push 가 허용되는 유일한 경우 — `CLAUDE.md` 핫픽스 절차. 충돌이 크면 PR 로 바꾼다)
