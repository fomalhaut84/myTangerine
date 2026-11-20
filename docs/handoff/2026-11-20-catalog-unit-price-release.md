# 인계 노트 — 2026-11-20(오후), 상품 카탈로그 · 원문 단가 · v2.9.1 · v2.10.0

직전 노트: `2026-11-20-conflict-product-edit-sync-mark.md`. 이 노트가 최신이다.

**실데이터 영향 (있음 — 모두 사용자 실행 · 또는 자동 배포):**
- **배포 2회(자동 · 모두 통과):** `v2.9.1`(effect 보안 오버라이드 · #308) · `v2.10.0`(#311 · #312 · #316 · #318 · #320 · #323). 마이그레이션 · `.env` · 시트 변경 없음
- **서버 pm2:** `pm2-logrotate` 설치(사용자 실행) — max_size 50M · retain 30 · compress · 매일 자정 · TZ Asia/Seoul. **서버 전역**(다른 프로젝트 pm2 앱에도 적용)
- **운영 통계 금액 정정(v2.10.0):** 2024 `10kg (30,000 / box)` 3건 35,000 → 30,000(매출 −15,000). DB · 시트 데이터는 바뀌지 않았다(금액은 매번 계산)
- **읽기 전용 조회(사용자):** v2.9.0 운영 확인(대기 표시 0 · 상태 변경 1건 정상) · 운영 원문 `product_selection` 연도별 분포(13종 전부 `(가격 / box)` · 종류만 원문 0)
- **로컬:** 띄운 서비스 없음 · 로컬 DB 무접촉

**관측 시점:** dev `0b2fe50` · main `7611590` (`v2.10.0`) · 열린 PR 0 (dependabot 제외) · CI(dev) success

## 이 세션에서 한 일

1. **v2.9.0 운영 확인** — 웹 상태 변경 1건(DB id 1492 · 시트 394행) 정상 · `sheet-write-pending` 잔존 0
   - 화면 번호는 시트 행 번호다(DB id 와 다름). DB 시각은 UTC — psql 세션은 `Asia/Seoul`
2. **#298** effect ReDoS → PR #308 — `pnpm.overrides` `effect@<3.22.1 → ^3.22.5` (prisma 7.x 안정판이 effect 3.20.0 고정) → **v2.9.1**(#309)
3. **#277** → PR #311 — CI 에 web lint · test · build · eslint 9 flat config · 기준선 오류 4 · 경고 10 → 정리 **#310**
4. **#276** → PR #312 — pm2 로그 회전 런북 · fork 뒤 로그 파일명 정정(`<앱>-out-<pm2 id>.log`) · 운영 SQL 시각 조건은 UTC
5. **#296 설계** — 결정 3개(아래) · 하위 이슈 #313 · #314 · #315
6. **#313** → PR #316 — core 상품 카탈로그(`catalog/products.ts`) · 동작 불변(회귀 31건 먼저 · 감사 9/9)
7. **#317** → PR #318 — **단가는 주문 원문(폼 문구)에서** · 코드 가격표 삭제 · 웹 정정은 같은 시즌(7월 경계) 폼 문구 · 못 찾으면 400 · 수량만 고치면 원문 유지
   - 처음엔 "주문별 단가 DB 저장(마이그레이션 · 백필)" 으로 설계했다가 사용자 지적("주문에 단가가 물고 들어온다")으로 뒤집었다
8. **#319** → PR #320 — 정정이 막힐 때 대처(주문 삭제 후 폼 재주문) · 오류 문구 · 런북
9. **릴리즈 PR #321 Codex P2** → **#322** → PR #323 — hybrid 에서 DB · 시트가 같은 `상품 선택` 원문을 쓰게(`resolvedSelection`)
10. **v2.10.0**(#321) 배포

## 결정된 것

| 결정 | 근거 |
|---|---|
| 단가의 정본 = 구글 폼 문구(`상품 선택` 원문). 코드 가격표 없음 | 사용자 2026-11-20 — "시즌 가격은 폼에서 정한다 · myTangerine 은 오주문 수량 · 상품만 고치고 단가는 바꾸지 않는다" |
| 가격 변동이 과거 주문 금액에 영향을 주면 안 된다 | 사용자 |
| 시즌 = 11월 하순 ~ 다음 해 1월 중순 → 코드 경계 7월(7월 ~ 다음 해 6월) | 사용자 설명 · 구현 |
| 웹 정정에서 같은 시즌에 그 규격 주문이 없으면 **막는다** · 지금 바꿔야 하면 주문 삭제 후 폼 재주문 | 사용자 |
| #296 카탈로그 = core 코드 모듈 · web 은 API(`GET /api/orders/products`)로 받기 · 통계 응답은 상품별 맵으로 교체(옛 필드 삭제) | 사용자 |
| 카탈로그에 등록한 상품만 유효("3kg 무효" 유지) | 설계 원칙(사용자 승인한 계획) |
| pm2 로그 회전 = `pm2-logrotate` 서버 전역(A) | 사용자 |
| #314 · #315 는 같은 릴리즈로만 배포(응답 형태 변경) | 설계 |

## 결정되지 않은 것

- **규격 자동 인식** — 폼 문구 `규격 (가격 / box)` · 수량 칸 `규격 수량` 형식을 그대로 읽어 새 규격을 코드 수정 없이 알아볼지. #313 의 "등록된 상품만 유효" 와 충돌 → 사용자에게 아직 묻지 않았다(#314 착수 전에)
- #225 수동 동기화 5분 상한 — (가) 묶음 / (나) 비동기
- #223 PWA — A 제거(권장) / B webpack
- #239 착수 전 운영 로그에서 confirm 두 경로 호출이 없는지 사용자 확인
- 같은 칸 동시 쓰기 시트 순서 역전(#301 · #305 의 남는 틈) — 이슈 미생성

## 다음 세션의 첫 액션 후보

1. **규격 자동 인식 여부 결정(사용자)** → #314 범위가 달라진다
2. **#314 api 통계 · 요약 상품별 맵** — `/summary` · `/stats` · `/stats/monthly` · `/labels/grouped` · CSV · 비상품 누락 수정 · `GET /api/orders/products`. #317 리뷰 info 이월분: PATCH 마다 전체 주문 읽기(I-3) · 단가 없음 경고를 앱 로거로(I-4). **#315 와 같은 릴리즈**
3. **#315 web** — 상품 목록 API · 카드 · 차트 · 배지 · 필터
4. #310 web lint 기준선 정리 · #276 완료 조건(회전 뒤 `pm2 logs` 새 줄 — 사용자 확인 대기) · #239 · #225

## 주의사항

- **금액 계산이 바뀌었다(v2.10.0):** `calculateOrderAmount(order)` = `order.unitPrice`(원문 `(N / box)`) × 수량. `Config.productPrices` · `getPricesForYear` 는 **없다** — 옛 노트 · 문서의 가격표 언급을 믿지 않는다
- 원문에 단가가 없으면 금액 0 + `console.warn` 1회(운영 0건). 새로 생기면 통계에서 조용히 빠지니 로그(`[stats] 주문 원문에 단가가 없어`)를 본다
- **웹 상품 정정:** `상품 선택` 에 폼 문구를 쓴다(예전 #282 는 종류만 `10kg`). API 가 `findSeasonSelection` → `resolveProductPatch` → `seasonSelection` · `resolvedSelection` 을 DB · 시트에 넘긴다. 시즌 첫 며칠 · 새 규격 직후에는 400(정상 — 런북)
- 시트 `상품 선택` 을 손으로 고치지 않는다(hybrid 정본 DB · S-10)
- **카탈로그:** 상품 지식은 `packages/core/src/catalog/products.ts` 하나. DB 칼럼 `quantity5kg` · `quantity10kg` 는 스키마 고정(`QUANTITY_STORAGE_FIELD`)
- `pm2-logrotate` 는 **서버 전역** — 다른 프로젝트 런북과 값이 겹치지 않는지 확인. 첫 회전(자정) 뒤 `pm2 logs myTangerineSync` 새 줄 확인이 #276 완료 조건(닫혔지만 사용자 확인 미수신)
- **운영 SQL:** DB 시각은 UTC `timestamp` · psql 세션 `Asia/Seoul` → `now() AT TIME ZONE 'UTC'` (런북)
- 화면 주문 번호 = 시트 행 번호(`sheet_row_number`) · DB `id` 와 다르다
- 피쳐 PR 이 merge commit 으로 들어간 사례(#312) — 피쳐는 ▼ Squash, 릴리즈는 ▼ merge commit 을 직접 고르게 안내한다
- 검증 기준선(dev `0b2fe50`): core lint 경고 3 · 타입 1(`sync-engine.ts`) / api 타입 43 · eslint 크래시 / web lint 오류 4 · 경고 10(#310) / sync-service 타입 5 · 테스트 63
- 로컬 Node — `export PATH="/usr/local/bin:$PATH"`(v24). 이게 없으면 api 테스트가 환경 문제로 실패한다(리뷰 에이전트에게도 알린다)
- 태그 push 때 "Bypassed rule violations" 는 정상(관리자 우회)

## 재현이 필요한 절차

- **운영 원문 분포 확인(읽기 전용 · 사용자 서버):**
  `psql "${DATABASE_URL%%\?*}" -c "SELECT EXTRACT(YEAR FROM timestamp) AS year, product_selection, count(*) FROM orders GROUP BY 1, 2 ORDER BY 1, 3 DESC;"`
- **최근 변경 주문 · 이력(읽기 전용):** `SELECT ... FROM orders ORDER BY updated_at DESC LIMIT 5;` · `order_change_logs ORDER BY changed_at DESC LIMIT 5` — 시간 조건은 UTC 로
