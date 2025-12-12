# myTangerine 개발 로드맵

> 마지막 업데이트: 2025-12-12
> 현재 진행: Phase 1 완료, Phase 2.1 진행 중, PDF 내보내기 기능 추가

## 전체 작업 순서

```
Phase 1: 빠른 가치 제공 (1-2주)
  └─ #64 (주문 검색 개선) → #65 (라벨 필터링)

Phase 2: 아키텍처 전환 (6-10주)
  └─ #68 (Google Sheets → PostgreSQL)

Phase 3: 상태 시스템 개편 (2-3주)
  └─ #67 (3단계 상태) + #66 (확인 취소 + Soft Delete)
```

**총 예상 기간**: 8-12주 (병렬 진행 시)

---

## Phase 1: 빠른 가치 제공 ✅ 완료

### ✅ 완료된 작업
- **#64: 주문 목록 검색 범위 확장 및 검색 상태 유지** (완료: 2025-12-10, PR #69)
- **#65: 라벨 생성 기능 개선 - 상태별 필터링** (완료: 2025-12-10, PR #70)
- **추가 개선: 주문 목록 버그 수정 + 라벨 정렬 기능** (완료: 2025-12-10, PR #72)
- **#98: 주문 목록 PDF 내보내기 기능** (완료: 2025-12-12, PR #101)

### 🔄 진행 중
- 없음

### ⏳ 대기 중
- 없음

---

## 이슈 #98: 주문 목록 PDF 내보내기 기능

**상태**: ✅ 완료
**담당**: Claude Code
**시작일**: 2025-12-11
**완료일**: 2025-12-12
**GitHub**: https://github.com/fomalhaut84/myTangerine/issues/98
**PR**: https://github.com/fomalhaut84/myTangerine/pull/101

### 요구사항
- [x] pdfmake 라이브러리 설치 및 한글 폰트 지원
- [x] PDF 데이터 변환 로직 구현
- [x] API 엔드포인트 구현 (`GET /api/orders/report`)
- [x] 라벨 페이지에 PDF 다운로드 기능 추가
- [x] 선택된 항목만 PDF로 생성
- [x] 버그 수정 (수량 0 표시, 디폴트 보내는 사람 정보)

### 구현 체크리스트
- [x] Week 1-2: 백엔드 구현
  - [x] pdfmake 설치 및 설정
  - [x] 한글 폰트 (NanumGothicCoding) 추가
  - [x] PDF 타입 정의 (`PdfTableRow`, `PdfOptions`)
  - [x] PDF 데이터 변환 (`pdf-formatter.ts`)
  - [x] PDF 생성 유틸리티 (`pdf-generator.ts`)
  - [x] API 엔드포인트 구현
- [x] Week 3: 프론트엔드 통합
  - [x] 라벨 페이지에 PDF 버튼 추가
  - [x] 선택된 항목만 처리하도록 구현
  - [x] 버튼 순서 조정 (복사 → 출력 → 확인 → PDF)
  - [x] 주문 목록 페이지에서 PDF 기능 제거
- [x] 버그 수정
  - [x] 수량이 0으로 표시되는 문제 해결
  - [x] 디폴트 보내는 사람 정보 미표시 문제 해결

### 작업 노트
- **PDF 레이아웃**: A4 Landscape, 자동 페이지네이션
- **한글 폰트**: NanumGothicCoding TTF 사용
- **API 엔드포인트**: 필터링, 정렬, 페이지네이션 지원
- **버그 수정**:
  - `order.quantity` 필드 사용으로 수량 문제 해결
  - `sheetRowToOrder(row, config)` 호출로 디폴트 정보 표시

### P0/P1 보안 및 동시성 개선
- **API Key 보호**: Next.js API Route Proxy(`packages/web/src/app/api/sync/route.ts`)를 추가해 `API_SECRET_KEY`를 서버 전용으로 유지하고 `requireApiKey` 미들웨어를 fail-closed로 전환했습니다. 클라이언트는 proxy를 통해서만 sync를 호출해 비밀 키 노출을 차단합니다.
- **분산 락 시스템**: `@mytangerine/core`에 `DistributedLockService`를 도입해 API와 Sync Service가 동일한 Prisma `DistributedLock` 테이블을 공유합니다. 락 TTL을 20분으로 늘려 장시간 싱크도 안전하며 graceful shutdown 시 진행 중 작업이 완료될 때까지 대기합니다.
- **타임아웃 정렬**: Lock TTL, SyncEngine 실행 시간, Next.js proxy timeout을 모두 20분으로 정렬했습니다. Fastify 라우트별 timeout 미지원 사실을 주석으로 남겨 운영 리스크를 명시했습니다.
- **타입 안정성**: `withDistributedLock` 헬퍼가 null-safe하게 개선되어 락 획득 실패/만료 상황을 타입 수준에서 처리합니다. PollingScheduler는 promise 추적을 추가해 수동 싱크와 예약 싱크 모두 graceful shutdown 범위에 포함됩니다.

---

## 이슈 #64: 주문 목록 검색 범위 확장 및 검색 상태 유지

**상태**: ✅ 완료
**담당**: Claude Code
**시작일**: 2025-12-10
**완료일**: 2025-12-10
**GitHub**: https://github.com/fomalhaut84/myTangerine/issues/64

### 요구사항
- [x] 검색에서 발송인(주문자) 정보도 검색 가능
  - 현재: 수취인(이름, 주소, 전화번호)만 검색
  - 변경: 발송인(이름, 주소, 전화번호)도 포함
- [x] 검색 상태 URL 쿼리로 유지
  - 상세 페이지 갔다가 돌아와도 검색 결과 유지
  - 뒤로가기 시 검색 상태 복원

### 구현 체크리스트
- [x] `packages/web/src/app/orders/page.tsx` 수정
  - [x] 검색 필터 로직에 `order.sender` 필드 추가
  - [x] URL 쿼리 파라미터로 상태 관리 (`useSearchParams`, `useRouter`)
  - [x] `searchTerm`, `statusFilter`, `productTypeFilter` 등을 URL에 동기화
  - [x] Suspense 경계 추가로 useSearchParams() 오류 해결
- [x] `packages/web/src/app/orders/[orderId]/page.tsx` 수정
  - [x] "주문 목록으로 돌아가기" 링크에 쿼리 파라미터 유지
  - [x] 예: `/orders?search=김철수&status=new&productType=5kg`
- [x] 빌드 및 테스트
  - [x] Next.js 빌드 성공 확인
  - [x] 개발 서버 정상 실행 확인

### 작업 노트
- **Suspense 경계 추가**: `useSearchParams()` 사용 시 발생하는 Next.js 프리렌더링 오류를 해결하기 위해 OrdersPageContent 컴포넌트를 Suspense로 감쌈
- **파일 변경**:
  - `packages/web/src/app/orders/page.tsx`: 검색 범위 확장, URL 쿼리 상태 관리, Suspense 추가
  - `packages/web/src/app/orders/[orderId]/page.tsx`: 뒤로가기 링크에 쿼리 파라미터 유지

---

## 이슈 #65: 라벨 생성 기능 개선 (상태별 필터링)

**상태**: ✅ 완료
**담당**: Claude Code
**시작일**: 2025-12-10
**완료일**: 2025-12-10
**GitHub**: https://github.com/fomalhaut84/myTangerine/issues/65
**PR**: https://github.com/fomalhaut84/myTangerine/pull/70

### 요구사항
- [x] API에 `status` 쿼리 파라미터 추가
- [x] 프론트엔드에 상태 필터 UI 추가
- [x] 상태: new / completed / all

### 구현 체크리스트
- [x] API 수정 (`packages/api/src/routes/labels.ts`)
  - [x] `status` 쿼리 파라미터 파싱 및 검증 (TypeScript 제네릭 타입 적용)
  - [x] `sheetService.getOrdersByStatus(status)` 호출
  - [x] Fastify 스키마 기반 자동 검증
- [x] 프론트엔드 수정 (`packages/web/src/app/labels/page.tsx`)
  - [x] 상태 필터 UI 추가 (라디오 버튼)
  - [x] `useGroupedLabels` 훅에 `status` 파라미터 전달
- [x] React Query 캐시 키 업데이트
- [x] 테스트 및 빌드 확인

### 작업 노트
- **TypeScript 타입 안전성**: Fastify 제네릭 타입으로 타입 추론 강화
- **성능 개선**: `EMPTY_MESSAGES` 객체를 핸들러 외부로 이동하여 매 요청마다 객체 생성 방지
- **코드 품질**: codex-cli 코드 리뷰 통과
- **enum 기반 구현**: 향후 #67에서 3단계 상태 확장 대비

---

## 추가 개선: 주문 목록 버그 수정 + 라벨 정렬 기능

**상태**: ✅ 완료
**담당**: Claude Code
**완료일**: 2025-12-10
**PR**: https://github.com/fomalhaut84/myTangerine/pull/72

### 버그 수정

#### 주문 목록 상태 필터 버그
**문제**: 주문 목록에서 '전체' 상태 선택 시 '신규'로 강제 변경

**원인**: `packages/web/src/app/orders/OrdersPageContent.tsx:56`에서 `value === 'all'` 조건이 모든 'all' 값(status='all', productType='all')을 URL에서 삭제

**해결**: productType='all'만 삭제하고 status='all'은 유효한 값으로 유지
```typescript
// BEFORE
if (value === '' || value === 'all' || (key === 'page' && value === 1)) {
  params.delete(key);
}

// AFTER
if (value === '' || (key === 'productType' && value === 'all') || (key === 'page' && value === 1)) {
  params.delete(key);
}
```

### 기능 추가

#### 라벨 페이지 정렬 기능
- **정렬 기준**: 날짜순 / 보내는사람순
- **정렬 방향**: 오름차순 / 내림차순
- **구현 위치**: `packages/web/src/app/labels/page.tsx`
- **날짜순 정렬**: 타임스탬프 기반 비교
- **보내는사람순 정렬**: 한국어 이름 사전순 (`localeCompare('ko-KR')`)

### 테스트 환경 개선

#### vitest ESM 호환성 문제 해결
- vitest 다운그레이드: `4.0.15` → `1.6.1`
- vitest 설정 파일 확장자 변경: `vitest.config.ts` → `vitest.config.mts`
- 결과: ✅ 테스트 16/16 통과, ✅ 빌드 성공

---

## Phase 2: 아키텍처 전환 (6-10주)

**상태**: 🔄 진행 중 (Phase 2.1)
**시작일**: 2025-11-25

### 이슈 #68: Google Sheets → PostgreSQL

**GitHub**: https://github.com/fomalhaut84/myTangerine/issues/68
**계획 문서**: [Phase 2.1 구현 계획](/.claude/plans/jiggly-jingling-adleman.md)

#### Phase 2.1: 인프라 준비 ✅ 완료 (2025-12-12)
- [x] PostgreSQL 16 인프라 프로비저닝
- [x] Prisma 스키마 설계 및 마이그레이션
- [x] 싱크 서비스 폴링 버전 구현
  - [x] SyncEngine (증분/전체 싱크)
  - [x] PollingScheduler (node-cron 기반)
  - [x] Graceful shutdown 처리
  - [x] Sheets 싱크 필드 업데이트 (DB_SYNC_STATUS, DB_SYNC_AT, DB_SYNC_ID)
- [x] DatabaseService 구현
  - [x] Prisma Client 기반 CRUD
  - [x] upsertOrder() 메서드
  - [x] 기존 SheetService와 동일한 인터페이스
- [x] 문서화
  - [x] [Sync Service 가이드](../docs/sync-service.md) 작성

**참고**: 상세 내용은 [docs/sync-service.md](../docs/sync-service.md) 참조

#### Phase 2.2: 초기 데이터 적재 (1주)
- [ ] 전체 동기화 실행
- [ ] 결과 검증
- [ ] Sheets에 싱크 상태 필드 추가
- [ ] 성능 테스트

#### Phase 2.3: 하이브리드 운영 (4-6주)
- [ ] Core DatabaseService 구축
- [ ] API 서버 DB 연결
- [ ] 모니터링 구성
- [ ] 정합성 검증

#### Phase 2.4: 완전 전환 (1-2주)
- [ ] SheetService 코드 제거
- [ ] 최종 테스트
- [ ] 문서 업데이트

---

## Phase 3: 상태 시스템 개편 (2-3주)

**상태**: ⏳ 대기 중
**예상 시작**: Phase 2 완료 후

### 이슈 #67: 주문 상태 3단계 고도화

**GitHub**: https://github.com/fomalhaut84/myTangerine/issues/67

- [ ] OrderStatus 타입 변경 (신규주문/입금확인/배송완료)
- [ ] DB 스키마 마이그레이션
- [ ] Core 서비스 수정
- [ ] API 엔드포인트 수정
- [ ] 프론트엔드 UI 수정

### 이슈 #66: 확인 취소 + Soft Delete

**GitHub**: https://github.com/fomalhaut84/myTangerine/issues/66

- [ ] 확인 취소 기능 구현
- [ ] Soft Delete 구현 (deleted_at 필드)
- [ ] API 엔드포인트 추가
- [ ] 프론트엔드 버튼 추가

**병행 작업**:
- #67과 #66의 스키마 변경을 함께 설계
- DB 마이그레이션 스크립트 통합

---

## 진행 상황 요약

| Phase | 이슈 | 상태 | 진행률 | 완료일 | PR |
|-------|------|------|--------|--------|-----|
| Phase 1 | #64 | ✅ 완료 | 100% | 2025-12-10 | #69 |
| Phase 1 | #65 | ✅ 완료 | 100% | 2025-12-10 | #70 |
| Phase 1 | 추가 개선 | ✅ 완료 | 100% | 2025-12-10 | #72 |
| 추가 기능 | #98 | ✅ 완료 | 100% | 2025-12-12 | #101 |
| Phase 2.1 | #68 | ✅ 완료 | 100% | 2025-12-12 | - |
| Phase 2.2 | #68 | ⏳ 대기 중 | 0% | - | - |
| Phase 2.3 | #68 | ⏳ 대기 중 | 0% | - | - |
| Phase 3 | #67 | ⏳ 대기 중 | 0% | - | - |
| Phase 3 | #66 | ⏳ 대기 중 | 0% | - | - |

---

## 병렬 진행 가능성

- ✅ **Phase 1 (#64, #65)** + **Phase 2 시작 (#68 인프라 준비)**
  - 프론트엔드 팀: #64, #65 작업
  - 백엔드/인프라 팀: #68 Phase 2.1 작업

- ✅ **Phase 3 (#67 + #66)**
  - 백엔드: 상태 로직, 마이그레이션
  - 프론트엔드: UI 업데이트

---

## 주의사항

### Phase 1
- #65 개발 시 상태 필터를 enum 기반으로 구현 (향후 확장 대비)
- URL 쿼리 파라미터 구조 유연하게 설계

### Phase 2
- 하이브리드 운영 단계에서 **기능 동결** 필요
- 롤백 포인트 명확히 정의
- 정합성 검증 스크립트 운영

### Phase 3
- #67과 #66의 스키마 설계를 **먼저 확정**
- 상태 전환 규칙 명확히 문서화
- QA/CS팀과 커뮤니케이션

---

## 변경 이력

- 2025-12-10: 로드맵 생성
- 2025-12-10: #64 시작 및 완료 (PR #69)
- 2025-12-10: #65 시작 및 완료 (PR #70)
- 2025-12-10: 추가 개선 작업 완료 (PR #72 - 주문 목록 버그 수정 + 라벨 정렬 기능)
- 2025-12-10: **Phase 1 완료** ✅
- 2025-11-25: **Phase 2.1 시작** (PostgreSQL 마이그레이션)
- 2025-12-12: #98 시작 및 완료 (PR #101 - PDF 내보내기)
- 2025-12-12: P0/P1 보안 · 동시성 개선 (PR #101 - API Key 보호, 분산 락)
- 2025-12-12: **Phase 2.1 완료** ✅ (Sync Service 구현)
- 2025-12-12: docs/sync-service.md 문서 추가
