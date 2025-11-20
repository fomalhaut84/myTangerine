# TypeScript 확장 계획서

## 문서 정보
- **작성일**: 2025-11-20
- **목적**: myTangerine 프로젝트를 TypeScript 기반으로 확장하기 위한 기술 분석 및 구현 계획
- **상태**: 계획 단계

---

## 1. 현재 Python 코드베이스 분석

### 1.1 아키텍처 개요

현재 Python 기반 시스템은 CLI 애플리케이션으로 구성되어 있으며, 다음과 같은 구조를 가집니다:

```
src/
├── config/           # 환경 변수 및 설정 관리
├── handlers/         # Google Sheets API 및 데이터 처리
├── formatters/       # 출력 포맷팅
├── exceptions/       # 커스텀 예외
└── main.py          # 진입점
```

### 1.2 핵심 의존성 분석

| 라이브러리 | 목적 | 사용 위치 |
|---------|------|---------|
| `gspread` | Google Sheets API 클라이언트 | `sheet_handler.py` |
| `oauth2client` | Google OAuth2 인증 | `sheet_handler.py` |
| `pandas` | 데이터 프레임 조작 및 그룹화 | `sheet_handler.py`, `label_formatter.py` |
| `python-dotenv` | 환경 변수 로드 | `config.py` |

### 1.3 핵심 기능 분석

#### GoogleSheetHandler
- **역할**: Google Sheets API 상호작용
- **핵심 로직**:
  - OAuth2 서비스 계정 인증
  - 스프레드시트 데이터 조회 (`get_all_records()`)
  - 한국어 타임스탬프 파싱 (오전/오후)
  - 특정 셀 업데이트 (`update_cell()`)
- **pandas 의존도**: 높음 (DataFrame 사용)

#### LabelFormatter
- **역할**: 배송 라벨 포맷팅 및 주문 집계
- **핵심 로직**:
  - 날짜별, 발송인별 그룹화 (`groupby()`)
  - 문자열 포맷팅 및 연결
  - 5kg/10kg 수량 집계
- **pandas 의존도**: 중간 (groupby, iterrows 사용)

#### OrderProcessor
- **역할**: 유틸리티 함수 제공
- **핵심 로직**:
  - 전화번호 포맷팅 (정규화)
  - 수량 추출 (문자열 → 숫자)
- **pandas 의존도**: 낮음 (pd.isna, pd.Series만 사용)

### 1.4 현재 시스템의 강점과 한계

#### 강점
- ✅ pandas를 활용한 강력한 데이터 처리
- ✅ 명확한 모듈 분리 (관심사 분리)
- ✅ 간결한 코드베이스
- ✅ 안정적인 CLI 실행 환경

#### 한계
- ❌ CLI만 지원 (웹 UI 없음)
- ❌ API 엔드포인트 없음 (외부 통합 불가)
- ❌ 실시간 처리 불가 (수동 실행)
- ❌ 다중 사용자 지원 불가
- ❌ 주문 이력 조회 기능 없음

---

## 2. TypeScript 확장 전략

### 2.1 확장 방향성

**선택한 접근 방식**: **하이브리드 아키텍처**

Python CLI와 TypeScript API 서버를 병행하여 운영:
- **Python CLI**: 기존 기능 유지 (로컬 실행, 스크립트)
- **TypeScript API**: 웹 서비스, API 엔드포인트, 향후 웹 UI

#### 이유
1. **점진적 마이그레이션**: 기존 Python 코드를 한번에 변경하지 않고 점진적 확장
2. **각 언어의 강점 활용**:
   - Python: 데이터 처리 (pandas), 빠른 스크립트 작성
   - TypeScript: 타입 안전성, 웹 생태계, 비동기 처리
3. **위험 최소화**: 기존 시스템은 그대로 유지하면서 새로운 기능 추가
4. **확장성**: 나중에 웹 UI, 모바일 앱 등으로 확장 가능

### 2.2 목표 아키텍처

```
┌─────────────────────────────────────────────────┐
│                 사용자 인터페이스                  │
├─────────────────┬───────────────────────────────┤
│   Python CLI    │    웹 브라우저/모바일 앱         │
│   (기존 유지)    │    (향후 추가)                  │
└────────┬────────┴───────────┬───────────────────┘
         │                    │
         │                    ↓
         │         ┌──────────────────────┐
         │         │  TypeScript API 서버  │
         │         │  (REST/GraphQL)       │
         │         └──────────┬───────────┘
         │                    │
         └────────────────────┴───────────────────┐
                              ↓                   │
                    ┌──────────────────┐          │
                    │  공유 비즈니스 로직 │          │
                    │  (TypeScript)    │          │
                    └─────────┬────────┘          │
                              ↓                   ↓
                    ┌──────────────────────────────┐
                    │   Google Sheets API          │
                    │   (데이터 저장소)              │
                    └──────────────────────────────┘
```

---

## 3. 기술 스택 선정

### 3.1 TypeScript 생태계 기술 매핑

| Python 기술 | TypeScript 대안 | 선정 이유 |
|-----------|---------------|---------|
| `gspread` | `googleapis` (공식) | Google의 공식 Node.js 클라이언트, 안정성 높음 |
| `oauth2client` | `google-auth-library` | Google 공식 인증 라이브러리 |
| `pandas` | 직접 구현 + lodash | pandas의 전체 기능은 불필요, 필요한 부분만 구현 |
| `python-dotenv` | `dotenv` | Node.js 표준 환경 변수 관리 |
| - | `zod` | 런타임 타입 검증 (환경 변수, API 응답) |

### 3.2 추천 기술 스택

#### 핵심 런타임 및 언어
- **Runtime**: Node.js 18+ (LTS)
- **Language**: TypeScript 5.x
- **Package Manager**: pnpm (빠르고 효율적인 디스크 사용)

#### 웹 프레임워크 (3가지 옵션)

##### Option 1: Express.js (추천 ⭐)
```typescript
// 장점: 성숙한 생태계, 많은 미들웨어, 학습 자료 풍부
// 단점: 구식 API (Promise/async-await 완벽 지원 X)
import express from 'express';
const app = express();
```

##### Option 2: Fastify
```typescript
// 장점: 빠른 성능, TypeScript 지원 우수, 현대적 API
// 단점: Express보다 생태계 작음
import Fastify from 'fastify';
const fastify = Fastify();
```

##### Option 3: Hono
```typescript
// 장점: 가볍고 빠름, Edge Runtime 지원
// 단점: 비교적 새로운 프레임워크
import { Hono } from 'hono';
const app = new Hono();
```

**선정**: **Fastify** (성능과 TypeScript 지원의 균형)

#### Google API 클라이언트
```typescript
import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';

// 공식 라이브러리로 타입 안전성 보장
const sheets = google.sheets({ version: 'v4', auth });
```

#### 데이터 처리
```typescript
import _ from 'lodash';
import { z } from 'zod';

// lodash: 배열/객체 조작
const grouped = _.groupBy(orders, 'date');

// zod: 타입 검증
const OrderSchema = z.object({
  timestamp: z.string(),
  sender: z.string(),
  // ...
});
```

#### 개발 도구
- **빌드 도구**: `tsx` (개발), `tsup` (프로덕션 빌드)
- **린터**: ESLint + `@typescript-eslint`
- **포매터**: Prettier
- **테스트**: Vitest (빠르고 현대적)
- **타입 체킹**: TypeScript strict mode

#### 배포 및 인프라
- **프로세스 관리**: PM2 (주요 방식)
- **CI/CD**: GitHub Actions
- **컨테이너**: Docker (선택적)
- **호스팅**: 단독 서버 (자체 관리)

### 3.3 프로젝트 구조 (제안)

```
myTangerine/
├── src/                    # Python CLI (기존)
│   └── ...
├── packages/               # TypeScript 모노레포
│   ├── core/              # 공유 비즈니스 로직
│   │   ├── src/
│   │   │   ├── types/           # 타입 정의
│   │   │   ├── services/        # Google Sheets 서비스
│   │   │   ├── formatters/      # 라벨 포맷팅
│   │   │   └── utils/           # 유틸리티
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── api/               # REST API 서버
│   │   ├── src/
│   │   │   ├── routes/          # API 라우트
│   │   │   ├── middleware/      # 미들웨어
│   │   │   └── server.ts        # 서버 진입점
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/               # 웹 UI (향후)
│       └── ...
├── pnpm-workspace.yaml    # 모노레포 설정
├── package.json
└── README.md
```

---

## 4. 단계별 구현 계획

### Phase 1: 기반 구축 (1-2주)

#### 목표
- TypeScript 프로젝트 초기 설정
- Google Sheets API 연동
- 핵심 타입 정의

#### 작업 항목
1. ✅ **프로젝트 초기화**
   ```bash
   pnpm init
   pnpm add -D typescript @types/node tsx tsup
   ```

2. ✅ **모노레포 설정**
   - `pnpm-workspace.yaml` 생성
   - `packages/core` 패키지 생성

3. ✅ **타입 정의**
   ```typescript
   // packages/core/src/types/order.ts
   export interface Order {
     timestamp: Date;
     sender: {
       name: string;
       address: string;
       phone: string;
     };
     recipient: {
       name: string;
       address: string;
       phone: string;
     };
     product: '5kg' | '10kg';
     quantity: number;
     status: 'pending' | 'confirmed';
   }
   ```

4. ✅ **Google Sheets 서비스 구현**
   ```typescript
   // packages/core/src/services/sheet-service.ts
   export class SheetService {
     async getNewOrders(): Promise<Order[]> { }
     async markAsConfirmed(rowIndex: number): Promise<void> { }
   }
   ```

5. ✅ **환경 변수 검증**
   ```typescript
   // packages/core/src/config.ts
   import { z } from 'zod';

   const envSchema = z.object({
     GOOGLE_CREDENTIALS_PATH: z.string(),
     SPREADSHEET_NAME: z.string(),
     // ...
   });
   ```

### Phase 2: 비즈니스 로직 이식 (2-3주)

#### 목표
- Python 코드의 핵심 로직을 TypeScript로 변환
- 단위 테스트 작성

#### 작업 항목
1. ✅ **데이터 파싱 로직**
   - 한국어 타임스탬프 파싱
   - 전화번호 포맷팅
   - 수량 추출

2. ✅ **그룹화 로직**
   ```typescript
   // lodash를 활용한 그룹화
   const byDate = _.groupBy(orders, o =>
     format(o.timestamp, 'yyyy-MM-dd')
   );

   const bySender = _.groupBy(dateOrders, o =>
     `${o.sender.name}-${o.sender.address}`
   );
   ```

3. ✅ **라벨 포맷터**
   ```typescript
   export class LabelFormatter {
     formatLabels(orders: Order[]): string { }
     private formatSenderGroup(orders: Order[]): string { }
     private formatRecipient(order: Order): string { }
   }
   ```

4. ✅ **테스트 작성**
   ```typescript
   // packages/core/src/__tests__/formatter.test.ts
   import { describe, it, expect } from 'vitest';

   describe('LabelFormatter', () => {
     it('should format phone numbers correctly', () => {
       // ...
     });
   });
   ```

### Phase 3: API 서버 구축 (2-3주)

#### 목표
- REST API 엔드포인트 제공
- 웹 UI의 기반 마련

#### 작업 항목
1. ✅ **Fastify 서버 설정**
   ```typescript
   // packages/api/src/server.ts
   import Fastify from 'fastify';

   const fastify = Fastify({
     logger: true
   });

   await fastify.listen({ port: 3000 });
   ```

2. ✅ **API 라우트 구현**
   ```typescript
   // GET /api/orders - 새 주문 조회
   // POST /api/orders/:id/confirm - 주문 확인
   // GET /api/orders/summary - 주문 요약
   // GET /api/labels - 라벨 생성
   ```

3. ✅ **에러 핸들링**
   ```typescript
   fastify.setErrorHandler((error, request, reply) => {
     // 커스텀 에러 처리
   });
   ```

4. ✅ **CORS 설정** (웹 UI 준비)

5. ✅ **API 문서** (OpenAPI/Swagger)

### Phase 4: 웹 UI (3-4주, 선택적)

#### 목표
- 웹 브라우저에서 주문 관리

#### 기술 스택 옵션
- **Option 1**: Next.js (React, SSR)
- **Option 2**: SvelteKit (Svelte, 가볍고 빠름)
- **Option 3**: Astro + React (정적 사이트)

#### 기능
- 주문 목록 조회
- 라벨 생성 및 다운로드
- 주문 요약 대시보드
- 주문 확인 처리

### Phase 5: 배포 및 운영 (1주)

#### 목표
- 단독 서버 환경에서 안정적인 배포 및 운영
- 경량화된 배포 전략 (Docker 선택적 사용)

#### 작업 항목
1. ✅ **프로세스 관리 (PM2)** - 주요 배포 방식
   ```bash
   # ecosystem.config.js
   module.exports = {
     apps: [{
       name: 'tangerine-api',
       script: './dist/server.js',
       instances: 2,
       autorestart: true,
       watch: false,
       max_memory_restart: '1G',
       env_production: {
         NODE_ENV: 'production'
       }
     }]
   };

   # 배포
   pnpm install --frozen-lockfile
   pnpm build
   pm2 start ecosystem.config.js --env production
   ```

2. ✅ **CI/CD 파이프라인** (GitHub Actions)
   ```yaml
   # .github/workflows/deploy.yml
   name: Deploy to Server

   on:
     push:
       branches: [main]

   jobs:
     deploy:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v3
         - uses: pnpm/action-setup@v2

         # 테스트 및 빌드
         - run: pnpm install
         - run: pnpm test
         - run: pnpm build

         # 서버 배포 (선택적)
         - name: Deploy to server
           run: |
             rsync -avz dist/ user@server:/app
             ssh user@server "pm2 restart tangerine-api"
   ```

3. ✅ **환경별 설정**
   - `.env.development` - 로컬 개발 환경
   - `.env.production` - 프로덕션 서버
   - 환경 변수 검증 (Zod)

4. ✅ **모니터링 및 로깅**
   - PM2 내장 모니터링 (`pm2 monit`)
   - 로그 파일 관리 및 로테이션
   - 에러 트래킹 (Sentry, 선택적)

5. 🔲 **Docker 컨테이너화** (선택적)
   - **단독 서버에서는 선택사항**
   - Dockerfile 준비만 해두기 (향후 필요시 사용)
   - 로컬 개발 환경 통일용으로 활용 가능

   ```dockerfile
   # Dockerfile (선택적)
   FROM node:18-alpine
   WORKDIR /app
   COPY package*.json pnpm-lock.yaml ./
   RUN corepack enable && pnpm install --frozen-lockfile
   COPY . .
   RUN pnpm build
   EXPOSE 3000
   CMD ["node", "dist/server.js"]
   ```

#### 배포 전략 비교

| 방식 | 장점 | 단점 | 추천도 |
|-----|------|------|--------|
| **PM2** | 간단, 가볍고 빠름, 리소스 효율적 | 환경 차이 가능성 | ⭐⭐⭐ 추천 |
| **Docker** | 환경 일관성, 격리, 롤백 용이 | 학습 곡선, 리소스 오버헤드 | ⭐⭐ 선택적 |
| **GitHub Actions** | 자동화, CI/CD 통합 | SSH 키 관리 필요 | ⭐⭐⭐ 추천 |

#### 권장 배포 흐름
```
1. GitHub에 push
2. GitHub Actions 자동 실행
   - 린트 & 테스트
   - 빌드
3. 서버에 rsync로 전송 (선택적)
4. PM2로 재시작
```

---

## 5. 위험 요소 및 대응 방안

### 5.1 기술적 위험

#### 1️⃣ pandas 기능 이식의 복잡성
- **위험**: pandas의 강력한 groupby, DataFrame 조작을 TypeScript로 구현하기 어려움
- **대응**:
  - 필요한 기능만 선택적으로 구현
  - lodash로 충분한 경우가 많음
  - 복잡한 데이터 처리는 Python CLI 유지

#### 2️⃣ Google API 할당량
- **위험**: API 호출 횟수 제한
- **대응**:
  - 캐싱 전략 (Redis 등)
  - 배치 처리 최적화
  - 할당량 모니터링

#### 3️⃣ 타입 불일치
- **위험**: Python과 TypeScript 간 데이터 구조 차이
- **대응**:
  - Zod를 활용한 런타임 검증
  - 철저한 타입 정의
  - 통합 테스트

### 5.2 프로젝트 위험

#### 1️⃣ 범위 확대 (Scope Creep)
- **위험**: 기능이 계속 추가되어 일정 지연
- **대응**:
  - MVP 우선 개발 (Phase 1-3)
  - Phase 4는 선택적
  - 명확한 마일스톤

#### 2️⃣ 기존 시스템과의 호환성
- **위험**: TypeScript 버전이 Python 버전과 다르게 동작
- **대응**:
  - 동일한 스프레드시트 스키마 사용
  - E2E 테스트로 검증
  - Python CLI는 안정화될 때까지 유지

---

## 6. 성공 지표 (KPI)

### 기술적 지표
- ✅ TypeScript strict mode 100% 준수
- ✅ 테스트 커버리지 80% 이상
- ✅ API 응답 시간 < 500ms (P95)
- ✅ 빌드 시간 < 30초

### 비즈니스 지표
- ✅ Python CLI와 동일한 결과 출력 (100% 정확도)
- ✅ API 엔드포인트 5개 이상 제공
- ✅ 에러율 < 1%

---

## 7. 다음 단계

### 즉시 수행
1. ✅ GitHub 이슈 생성 및 마일스톤 설정
2. ✅ `packages/core` 디렉토리 생성 및 초기화
3. ✅ TypeScript 설정 파일 작성

### 단기 (1주 이내)
1. ✅ Google Sheets API 연동 PoC (Proof of Concept)
2. ✅ 핵심 타입 정의
3. ✅ 개발 환경 설정 (ESLint, Prettier)

### 중기 (1개월 이내)
1. ✅ Phase 1-2 완료
2. ✅ 기본 API 엔드포인트 구현
3. ✅ 단위 테스트 작성

---

## 8. 참고 자료

### Google APIs
- [googleapis Node.js Client](https://github.com/googleapis/google-api-nodejs-client)
- [Google Sheets API v4 문서](https://developers.google.com/sheets/api)
- [google-auth-library](https://github.com/googleapis/google-auth-library-nodejs)

### TypeScript & Node.js
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Fastify 공식 문서](https://www.fastify.io/)
- [Zod 문서](https://zod.dev/)

### 도구
- [pnpm Workspace](https://pnpm.io/workspaces)
- [Vitest](https://vitest.dev/)
- [tsup](https://tsup.egoist.dev/)

---

## 9. 결론

이 계획서는 myTangerine 프로젝트를 TypeScript로 확장하기 위한 로드맵을 제시합니다. 하이브리드 아키텍처를 채택하여 기존 Python CLI의 안정성을 유지하면서, TypeScript API 서버를 통해 웹 생태계로의 확장 기반을 마련합니다.

**핵심 원칙**:
1. 점진적 마이그레이션 (Big Bang 방식 지양)
2. 타입 안전성 우선
3. 기존 시스템과의 호환성 유지
4. 테스트 주도 개발

**예상 타임라인**: 총 6-10주 (Phase 1-3 기준)

---

**문서 버전**: 1.0
**마지막 업데이트**: 2025-11-20
**작성자**: Claude Code (분석 및 계획)
