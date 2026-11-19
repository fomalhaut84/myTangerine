# 인계 노트 — 2026-11-19(저녁), hybrid DB 우선 · 자동 재조정 · 이슈 전수 정리 · v2.5.1 · v2.6.0

직전 노트: `2026-11-19-hermes-row-identity-ops.md`(같은 날 오전). 이 노트가 최신이다.

**실데이터 영향 (있음 — 모두 사용자가 서버에서 실행):**
- **배포 2회**
  - `v2.5.1`: 자동 배포 · 통과
  - `v2.6.0`: `--prerelease` 수동 배포
    - 마이그레이션 `20261120000000_add_original_input` 적용 — `orders.original_input` JSONB 추가만, 기존 행 NULL. `migrate status` 9개 up to date
    - `release-inplace.sh --confirm-manual` 로 "손 배포 확인" 기록
- **DB:** 위 컬럼 추가 외 데이터 변경 없음. `pg_dump` 백업 `~/mytangerine-20261119-171*.dump`(74K)
- **동작 변경(v2.6.0):**
  - 증분 동기화가 기존 주문의 DB 값을 바꾸지 않는다
  - sync-service 가 hybrid 시트 반영 실패 주문을 DB 값으로 시트에 자동으로 다시 쓴다(로그 `Sheet reconcile enabled (#231)` 확인 · 배포 시점 대상 0건)
- **서버 저장소 정리(사용자):**
  - **배포 SSH 개인키 `mytangerine-deploy` 가 저장소 폴더에 있었다(공개 저장소 · `.gitignore` 밖) → `shred -u` 삭제.** 공개키는 `authorized_keys` 에 1개 등록되어 있음을 확인했고, 개인키는 GitHub 시크릿에만 있다
  - 옛 `ecosystem.config.js` → `~/mytangerine-private/ecosystem.config.js.pre-256` 으로 이동
  - Prisma agent skills 설치물(`.agents/` · `.windsurf/` · `.claude/skills/prisma-*` · `skills-lock.json`) · npm `package-lock.json` 삭제 → `git status` 깨끗
- **GitHub:** 이슈 10건 닫음 · 12건 본문 보강(이전 본문은 코멘트로 보존) · 새 이슈 9건
- **로컬:** 띄운 서비스 없음 · 로컬 DB 무접촉

**관측 시점:** dev `ec3a301` · main `8e004c4` (`v2.6.0`) · 열린 PR 0 (dependabot 제외) · CI(dev) #290 머지 직후 실행 중

## 이 세션에서 한 일

1. **#261** → PR #273 — 동기화 상태 칸(`DB_SYNC_*`)을 10행씩 묶어 쓰기 전 · 후 타임스탬프 확인. 밀리면 쓰지 않고 멈춤 · `DB_SYNC_AT` = 행별 DB 반영 시각
2. **#266** → PR #274 — DB 다른 행 조회도 정규화 원문으로 비교(±27시간 후보)
3. 릴리즈 **`v2.5.1`**(#275 · 자동 배포 통과)
4. **이슈 22건 전수 검토**(실측 에이전트 3개)
   - 닫음: #9 · #10 · #13 · #15 · #25 · #27 · #91 · #143 (완료 · 낡음), #93 · #94 (계획 안 함)
   - 보강: #34 · #38 · #202 · #209 · #223 · #225 · #228 · #229 · #231 · #232 · #239 · #243
   - 새로: #276 pm2 로그 회전 · #277 web CI · #278 web E2E · #279 동기화 응답 정보
5. **#279** → PR #280 — 동기화 응답에 충돌 · 정지 정보 · 대시보드 경고(정지는 닫을 때까지)
6. **hybrid "DB 우선" 설계**(사용자와 생애주기 재검토) → 새 이슈 #281 · #282, #228 · #229 · #231 · #239 결정 반영
7. **#281** → PR #283
   - 증분은 새 주문만 만든다 · 시트와 다른 행은 `sheetDivergedRows` 로 알린다
   - `original_input` 보관(상세 전용 응답 — 라벨 응답 개인정보 노출을 감사에서 잡아 고침)
   - 시트 우선 가져오기(운영자 · `{"confirm":"sheet-first"}` · 전체 필드 이력 · 트랜잭션 · version 조건 갱신)
8. **#231** → PR #284 — `SheetReconciler`
   - 헤더 + 행을 새로 읽고 DB 와 다른 칸만 쓴다 · 쓰기 전 · 후 행 확인 · `updatedAt` 조건 해제
   - 백오프(조회에서 제외) · hybrid 에서만 · `#hermes` 3종
9. 릴리즈 PR #285 Codex P2 → **#286** → PR #287 — 시트에 없는 열에 써야 할 값이 있으면 실패 표시 유지(`판매` 는 빈 값과 같게)
10. 릴리즈 **`v2.6.0`**(#285 · prerelease 수동 배포)
11. **#289** → PR #290 — `prisma generate --no-hints` · 서버 잔재 `.gitignore` · 런북 개인키 경고

## 결정된 것

| 결정 | 근거 |
|---|---|
| **hybrid 정본 = DB.** 시트 → DB 는 새 주문 생성 때만, 이후 수정은 웹 → DB → 시트 (data-safety **S-10**) | 사용자 2026-11-19 |
| 주문자 입력은 반드시 보존 — 웹 수정은 DB · 시트 반영, 원본은 DB `original_input` | 사용자 |
| **과거 주문은 최초 입력값을 채우지 않는다**(백필 없음 · 원본을 확실히 알 수 없음) | 사용자 |
| 응답 시트는 사람이 고치지 않는다(삭제도 웹에서만) · 폼 "제출 후 응답 수정" 은 꺼져 있다 · `주문유형` 은 관리자 칸 | 사용자 |
| 시트 우선 전체 가져오기는 남긴다 — 운영자 복구 전용 | 사용자 |
| #231 = 안 A(cron 자동 재조정) | 사용자 |
| 상품 · 수량은 웹에서 고친다(#282 · 신규주문 · 입금확인만) | 사용자 |
| 상태 우회 API(일괄 · 단건 confirm)는 제거한다(#239) | 사용자 |
| #93 · #94(SheetService 제거 · 자체 폼) 계획 안 함 · #34 다크모드는 #209 뒤에 진행 | 사용자 |
| 재조정의 "확인 ~ 쓰기 틈" 위험(드물게 1~3칸이 다른 행에) — 감지 · 알림으로 받아들인다 | PR #284 · 사용자 확인(시트 열 · 중복 헤더 없음) |

## 결정되지 않은 것

- **#228 운영 미해결 충돌 25건** — DB 값으로 해결 처리하는 범위 · 방식(일괄?)은 착수 때 대상 조회 SQL 결과를 보고 사용자가 정한다
- #225 수동 동기화 5분 상한 — 안 (가) 대기를 묶음 단위로 / (나) 비동기
- #223 PWA — A 제거(권장) / B webpack 유지
- #239 착수 전 운영 nginx · api 로그에서 confirm 두 경로 호출이 없는지 사용자 확인

## 다음 세션의 첫 액션 후보

1. **#228 충돌 개념 폐지 · 25건 정리**
   - 먼저 대상 건수 · 필드 분포 조회 SQL(읽기만)을 사용자에게 받는다 → 해결 처리 방식 결정
   - 충돌 판정 코드 · `sheet_wins` · 미사용 훅을 정리한다
   - 데이터 경계라 data-safety-auditor 를 돌린다
2. **#282 웹 상품 · 수량 수정**(검증 오류 재계산 · 시트 쓰기 칸 증가 → 감사)
3. #239(우회 API 제거 · 호출 로그 확인 선행) · #229(503 정리 · 작음) · #225 · #288

## 주의사항

- **`main 에만 있는 커밋` 5 는 정상** — 릴리즈 merge commit 뿐이다. 지금은 dev 가 #290 만큼 앞서 있다(다음 릴리즈 대상)
- **v2.6.0 이후 동기화 의미가 바뀌었다**
  - 응답 · 로그의 `success` 는 **새로 만든 주문 수**다. 유지한 기존 주문은 `unchanged`
  - 시트와 DB 가 다른 행은 DB 를 유지하고 `sheetDivergedRows` · `Sheet row differs` warn 로 알린다
- **`POST /api/sync/full` 은 이제 "시트 우선 가져오기"(복구용)다** — 본문 `{"confirm":"sheet-first"}` 없이는 400. 실행법은 런북 `sheet-sync-operations.md` *복구*
- **재조정 경고 3종(`#hermes`):** 시트 재조정 정지 · 실패 · "다른 행에 써졌을 수 있음"(행 · 칸 수). 대응은 런북 신호 표
- 재조정 백오프는 프로세스 메모리라 sync 재시작하면 초기화된다(한 번 다시 시도할 뿐 · 안전)
- **손 배포에서 `pnpm prisma:generate` 는 `--no-hints`(#290 · 다음 릴리즈부터).** v2.6.0 이하 태그에서 "Prisma agent skills" 질문이 뜨면 No
- 서버 sync-service 는 `DATA_SOURCE` 를 api 와 같은 루트 `.env` 에서 읽는다(시작 로그 `Sheet reconcile enabled` 로 확인)
- **정정된 기록**
  - #143 닫기 코멘트의 "시트 원본을 고친다" → #282 로 정정했다
  - workflow.md 6절의 sync-service "테스트 없음" 은 틀리다(55건 · #277 범위)
  - README 의 다크모드 · Next 14 표기가 틀리다(#34 1단계)
- 로컬 Node — 검증은 `export PATH="/usr/local/bin:$PATH"`(v24). Node 20.18 에서는 Fastify `inject` 테스트가 cookie ESM 으로 실패
- Codex 재리뷰 — 릴리즈 PR #285 에 P2 반영 뒤 `@codex review` 를 잘못 1회 요청했다(규칙상 P2 는 재요청 안 함). 같은 실수 주의
- 사용자 응답 언어 — 서브에이전트 보고가 영어여도 한국어로 답한다

## 재현이 필요한 절차

- **prerelease 수동 배포:** 런북 `auto-deploy.md` *수동 마이그레이션* — sync 정지 → `pg_dump` → checkout · install · `prisma:generate` → `migrate status` → `prisma:deploy` → 빌드 4개 → api · web 재시작 → sync 시작 → `release-inplace.sh vX.Y.Z --yes --confirm-manual`
- **서버 저장소 잔재 확인:** `cd ~/myTangerine && git status --short` — 비어 있어야 한다. 배포 개인키 · 도구 잔재는 이제 `.gitignore` 로도 막혀 있다
