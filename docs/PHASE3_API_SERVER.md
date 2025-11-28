# Phase 3 - API 서버 아키텍처 & 사용 가이드

## 1. 개요
Phase 3에서는 `@mytangerine/core` 모듈 위에 Fastify 4 기반 REST API 서버(`@mytangerine/api`)를 구축했습니다. API는 주문 조회/요약/확인, 배송 라벨 생성을 HTTP 인터페이스로 노출하며 Swagger(OpenAPI 3.0) 문서와 CI 파이프라인으로 운영 신뢰도를 확보합니다.

## 2. 아키텍처

### Fastify 애플리케이션
- `createServer`에서 로거(pino-pretty dev preset), 포트/호스트, CORS를 환경 변수 기반으로 구성합니다.
- `/`와 `/health`는 애플리케이션 메타데이터와 배포 상태를 노출합니다.

### Core 연동
- `corePlugin`이 `Config`, `SheetService`, `LabelFormatter` 인스턴스를 Fastify 데코레이터(`fastify.core`)에 주입하여 모든 라우트가 동일한 시트/포맷터를 공유합니다.

### 미들웨어 & 유효성 검증
- `errorHandler`는 모든 오류를 일관된 `ErrorResponse`(JSON) 포맷으로 변환하고 5xx 메시지를 일반화합니다.
- `validate` 미들웨어는 Zod 스키마로 body/query/params를 검증하며 transform 결과를 Fastify 요청 객체에 반영합니다.

### 문서화 & 관측
- `@fastify/swagger` + `@fastify/swagger-ui`로 `/docs` 경로에 문서/샘플 응답을 제공합니다.
- 로거는 Fastify 내부 구조체를 유지한 채 pretty 모드로 출력되며, 서버가 SIGINT/SIGTERM을 수신하면 그레이스풀 셧다운을 수행합니다.

### 데이터 플로우
1. 라우트가 `SheetService.getNewOrders()`로 Google Sheet 데이터를 읽습니다.
2. `sheetRowToOrder`가 `Order` 객체로 정규화하고 `LabelFormatter`가 라벨 문자열을 생성합니다.
3. 주문 확정 시 `SheetService.markAsConfirmed()`로 원장 비고 컬럼을 업데이트합니다.

## 3. 환경 변수

| 키 | 설명 | 필수 | 기본값 |
| --- | --- | --- | --- |
| `PORT` | Fastify 서버 포트 | 선택 | `3000` |
| `HOST` | 바인딩 호스트 | 선택 | `0.0.0.0` |
| `NODE_ENV` | `development`/`production`/`test` | 선택 | `development` |
| `LOG_LEVEL` | pino 로그 레벨 | 선택 | `info` |
| `CORS_ORIGIN` | 허용 오리진 (`*` 또는 URL) | 선택 | `*` |
| `DEFAULT_SENDER_*` | 발송인 기본 정보(이름/주소/전화) | 필수 | 없음 |
| `GOOGLE_CREDENTIALS_FILE|JSON|PATH` | 서비스 계정 키 지정 방식 중 하나 | 필수 | 없음 |
| `SPREADSHEET_ID` | 시트 ID (선택) | 선택 | - |
| `SPREADSHEET_NAME` | 시트 탭 이름 | 선택 | `감귤 주문서(응답)` |

> 프로젝트 루트의 `.env.example`을 복사해 필요한 값을 채우면 됩니다. Monorepo 구조에서 모든 패키지(Core, API)가 동일한 환경 변수를 공유합니다.

## 4. 로컬 실행 & 테스트

### 설정
1. **프로젝트 루트**에서 `.env` 파일 생성: `cp .env.example .env` 후 필수 값 입력
2. `credentials.json` 파일을 프로젝트 루트에 배치
3. `pnpm install`

### 실행
- 개발 서버: `pnpm --filter @mytangerine/api dev`
- 빌드: `pnpm --filter @mytangerine/api build`
- 프로덕션 실행: `pnpm --filter @mytangerine/api start`

### 문서/헬스 엔드포인트
- Swagger UI: `http://localhost:3000/docs`
- 헬스체크: `curl http://localhost:3000/health`

### 테스트
```bash
# Core 테스트 (40/40)
pnpm --filter @mytangerine/core test

# API 테스트 (25/25)
pnpm --filter @mytangerine/api test

# 전체: 65/65 통과
```

## 5. API 엔드포인트

| Method | Path | 설명 |
| --- | --- | --- |
| GET | `/` | package 메타데이터 반환 |
| GET | `/health` | 서버 상태 및 버전 |
| GET | `/api/orders` | 확인되지 않은 주문 목록 |
| GET | `/api/orders/summary` | 5kg/10kg 수량·금액 요약 |
| POST | `/api/orders/confirm` | 모든 신규 주문을 "확인"으로 표시 |
| GET | `/api/labels` | text/plain 배송 라벨 |
| GET | `/docs` | Swagger UI |

### GET /health
```bash
curl -s http://localhost:3000/health | jq
```
```json
{
  "status": "ok",
  "timestamp": "2025-01-21T10:00:00.123Z",
  "version": "0.1.0"
}
```

### GET /
```bash
curl -s http://localhost:3000/ | jq
```
```json
{
  "name": "@mytangerine/api",
  "version": "0.1.0",
  "description": "myTangerine API 서버 (Fastify)"
}
```

### GET /api/orders
비고가 "확인"이 아닌 행을 `Order` 스키마로 반환합니다.

```bash
curl -s http://localhost:3000/api/orders | jq
```
```json
{
  "success": true,
  "count": 2,
  "orders": [
    {
      "timestamp": "2025-01-21T01:23:00.000Z",
      "timestampRaw": "2025. 1. 21. 오전 10:23:00",
      "status": "",
      "sender": {
        "name": "안세진",
        "address": "제주시 정실3길 113",
        "phone": "010-6395-0618"
      },
      "recipient": {
        "name": "홍길동",
        "address": "서울시 강남구 테헤란로 123",
        "phone": "010-1234-5678"
      },
      "productType": "5kg",
      "quantity": 2,
      "rowNumber": 17
    }
  ]
}
```

### GET /api/orders/summary
```bash
curl -s http://localhost:3000/api/orders/summary | jq
```
```json
{
  "success": true,
  "summary": {
    "5kg": { "count": 6, "amount": 210000 },
    "10kg": { "count": 3, "amount": 180000 },
    "total": 390000
  }
}
```

### POST /api/orders/confirm
```bash
curl -s -X POST http://localhost:3000/api/orders/confirm | jq
```
```json
{
  "success": true,
  "message": "5개의 주문이 확인되었습니다.",
  "confirmedCount": 5
}
```

### GET /api/labels
항상 `text/plain; charset=utf-8`으로 응답합니다.

```bash
curl -s http://localhost:3000/api/labels
```
```
====================
2025. 1. 21.
====================

보내는사람
제주도 제주시 정실3길 113 C동 301호 안세진 010-6395-0618

받는사람
서울시 강남구 테헤란로 123 홍길동 010-1234-5678
주문상품
5kg / 2박스

---

받는사람
경기도 성남시 수정구 김철수 010-5555-6666
주문상품
10kg / 1박스

=======================================

==================================================
주문 요약
--------------------
5kg 주문: 2박스 (70,000원)
10kg 주문: 1박스 (60,000원)
--------------------
총 주문금액: 130,000원
```

### GET /docs
Swagger UI에서 모든 엔드포인트/스키마/예제를 확인하고 Try it out 기능으로 바로 호출할 수 있습니다.

## 6. 오류 응답 포맷

```json
{
  "success": false,
  "error": "요청 데이터가 유효하지 않습니다.",
  "statusCode": 400,
  "timestamp": "2025-01-21T10:15:00.000Z"
}
```

5xx 에러에서는 `error` 메시지가 일반화되어 내부 구현이 노출되지 않습니다.

## 7. 운영 체크리스트

- ✅ 서비스 계정 키 갱신 시 `GOOGLE_CREDENTIALS_*` 중 한 값을 갱신하고 서버를 재시작
- ✅ 출력 라벨을 확인한 뒤 `POST /api/orders/confirm`을 호출해 시트를 동기화
- ✅ CI(`.github/workflows/ci.yml`)가 lint/test/build를 모두 통과해야만 배포
- ✅ PM2나 systemd로 프로세스를 관리할 경우 헬스체크 엔드포인트를 모니터링

## 8. 커밋 히스토리

| 커밋 | 설명 |
| --- | --- |
| `dcfeb84` | `.env.example`에 Core 필수 환경 변수 추가 (codex-cli 리뷰 반영) |
| `53d84dc` | GitHub Actions CI/CD 파이프라인 추가 |
| `1b5e543` | MockSheetService 및 routes 테스트 활성화 |
| `268f965` | OpenAPI 스키마 개선 (codex-cli 피드백 반영) |
| `e8b1ac5` | Swagger/OpenAPI 문서화 추가 |
| `b1813be` | 미들웨어 및 라우트 테스트 추가 |
| `4aad3f5` | 미들웨어 구현 및 에러 처리 개선 |
| `a6750eb` | API 라우트 구현 및 @mytangerine/core 연동 |
| `1898f6c` | API 서버 초기 구조 및 설정 |

## 9. 다음 단계 (Phase 2)

1. 인증/인가 및 rate limiting 추가로 `/api/*` 엔드포인트 보호
2. 주문/라벨 응답 캐싱 및 pagination, 메타데이터 필터링 등 운영 편의 기능 확장
3. 배포 환경 대비 metrics/alerting(Prometheus, Sentry 등)과 롤링 배포 전략(PM2/Docker) 확정
