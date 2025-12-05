# myTangerine 🍊

감귤 주문을 처리하는 TypeScript 기반 풀스택 주문 관리 시스템

## 프로젝트 소개

myTangerine은 구글 스프레드시트에 접수된 감귤 주문을 자동으로 처리하여 배송 라벨을 생성하고 주문을 관리하는 시스템입니다. TypeScript 모노레포 구조로 구성되어 있으며, REST API 서버와 웹 애플리케이션을 포함합니다.

## 주요 기능

- 📊 **구글 스프레드시트 연동**: 실시간으로 새로운 주문 데이터 조회
- 🌐 **웹 UI**: Next.js 기반 현대적인 대시보드 및 주문 관리 인터페이스
- 🔌 **REST API**: Fastify 기반 고성능 API 서버
- 🏷️ **배송 라벨 관리**: 날짜/발송인별 그룹화, 필터링, 다중 선택
- 📱 **전화번호 자동 포맷팅**: 010-XXXX-XXXX 형식으로 자동 변환
- 📦 **주문 요약 및 통계**: 5kg/10kg 박스별 수량 및 금액 집계, 월별 통계
- 📥 **CSV/Excel 다운로드**: 주문 데이터 내보내기
- 📊 **차트 및 분석**: 월별 매출 추이, 상품별 분석
- ✅ **주문 확인 처리**: 개별/일괄 주문 확인
- 🎨 **다크모드 지원**: 시스템 테마 자동 감지
- ⌨️ **키보드 단축키**: 빠른 네비게이션 및 작업
- 📱 **PWA 지원**: 오프라인 모드, 앱 설치 가능

## 기술 스택

### 프론트엔드
- **Next.js 14** (App Router, TypeScript)
- **React 18** + **TanStack Query**
- **Tailwind CSS** + **shadcn/ui**
- **Recharts** (차트)
- **next-pwa** (Progressive Web App)

### 백엔드
- **Fastify** (REST API 서버)
- **TypeScript**
- **Google Sheets API** (데이터 소스)
- **Zod** (스키마 검증)

### 모노레포
- **pnpm workspace** (패키지 관리)
- **tsup** (빌드)
- **Vitest** (테스트)
- **ESLint** + **Prettier** (코드 품질)

## 요구사항

- **Node.js** 20.x 이상
- **pnpm** 9.x 이상
- **Google Sheets API 서비스 계정** (credentials.json)

## 빠른 시작

### 1. 저장소 클론 및 의존성 설치

```bash
# 저장소 클론
git clone https://github.com/fomalhaut84/myTangerine.git
cd myTangerine

# pnpm 설치 (없는 경우)
npm install -g pnpm

# 의존성 설치
pnpm install
```

### 2. 환경 설정

#### 2.1 루트 환경 변수 (.env)

프로젝트 루트에 `.env` 파일을 생성하고 기본 발송인 정보를 설정합니다:

```bash
cp .env.example .env
```

`.env` 파일 내용:
```env
# API 서버 포트 (packages/api에서 사용)
PORT=3001

DEFAULT_SENDER_ADDRESS=제주도 제주시 정실3길 113 C동 301호
DEFAULT_SENDER_NAME=안세진
DEFAULT_SENDER_PHONE=010-6395-0618

# Google Sheets API 인증 파일 경로
GOOGLE_CREDENTIALS_FILE=credentials.json
```

#### 2.2 웹 환경 변수 (packages/web/.env.local)

웹 애플리케이션의 환경 변수를 설정합니다:

```bash
cp packages/web/.env.example packages/web/.env.local
```

`packages/web/.env.local` 파일 내용:
```env
# API 서버 URL (기본값: http://localhost:3001)
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001

# 웹 서버 포트 (기본값: 3000)
PORT=3000
```

#### 2.3 Google Sheets API 인증 설정

1. [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트 생성
2. Google Sheets API 활성화
3. 서비스 계정 생성 및 JSON 키 다운로드
4. 다운로드한 JSON 파일을 프로젝트 루트에 `credentials.json`으로 저장
5. 서비스 계정 이메일에 구글 스프레드시트("감귤 주문서(응답)") 편집 권한 부여

### 3. 빌드

```bash
# 모든 패키지 빌드
pnpm build
```

### 4. 개발 서버 실행

#### 방법 1: 모든 서비스 동시 실행 (권장)

```bash
# 터미널 1: API 서버 (http://localhost:3001)
pnpm --filter @mytangerine/api dev

# 터미널 2: 웹 애플리케이션 (http://localhost:3000)
pnpm --filter @mytangerine/web dev
```

개발 서버가 실행되면:
- **웹 UI**: http://localhost:3000
- **API 서버**: http://localhost:3001
- **API 문서**: http://localhost:3001/docs (Swagger UI)

#### 방법 2: 개별 패키지 실행

```bash
# Core 패키지 (watch 모드)
pnpm --filter @mytangerine/core dev

# API 서버만 실행
pnpm --filter @mytangerine/api dev

# 웹 앱만 실행
pnpm --filter @mytangerine/web dev
```

### 5. 프로덕션 빌드 및 실행

```bash
# 전체 빌드
pnpm build

# API 서버 실행
pnpm --filter @mytangerine/api start

# 웹 앱 실행 (다른 터미널에서)
pnpm --filter @mytangerine/web start
```

## 스크린샷

### 대시보드
![대시보드 - 주문 요약 및 통계]

### 주문 관리
![주문 목록 - 검색, 필터링, 페이지네이션]

### 라벨 관리
![라벨 그리드 뷰 - 날짜/발송인별 그룹화]

### 다크모드
![다크모드 지원]

> 스크린샷은 추후 추가 예정

## 테스트

```bash
# 모든 패키지 테스트
pnpm test

# 개별 패키지 테스트
pnpm --filter @mytangerine/core test
pnpm --filter @mytangerine/api test
pnpm --filter @mytangerine/web test

# 커버리지 포함 테스트
pnpm --filter @mytangerine/core test:coverage
```

## 유용한 명령어

```bash
# 린트 검사
pnpm lint

# 타입 체크
pnpm --filter @mytangerine/core type-check
pnpm --filter @mytangerine/api type-check

# 빌드 산출물 제거
pnpm --filter @mytangerine/core clean

# 특정 패키지에 의존성 추가
pnpm --filter @mytangerine/web add <package-name>

# 전체 의존성 재설치
rm -rf node_modules packages/*/node_modules
pnpm install
```

## 프로젝트 구조

```
myTangerine/
├── packages/
│   ├── core/                    # 핵심 비즈니스 로직
│   │   ├── src/
│   │   │   ├── config/          # 설정 관리
│   │   │   ├── services/        # Google Sheets 서비스
│   │   │   ├── formatters/      # 라벨 포맷팅
│   │   │   ├── types/           # TypeScript 타입 정의
│   │   │   └── index.ts
│   │   ├── __tests__/           # 테스트
│   │   ├── package.json
│   │   └── tsup.config.ts
│   │
│   ├── api/                     # Fastify API 서버
│   │   ├── src/
│   │   │   ├── routes/          # API 라우트
│   │   │   │   ├── orders.ts    # 주문 관련 API
│   │   │   │   └── labels.ts    # 라벨 관련 API
│   │   │   ├── plugins/         # Fastify 플러그인
│   │   │   ├── core.ts          # Core 서비스 주입
│   │   │   └── index.ts         # 서버 진입점
│   │   ├── package.json
│   │   └── tsup.config.ts
│   │
│   └── web/                     # Next.js 웹 애플리케이션
│       ├── src/
│       │   ├── app/             # App Router 페이지
│       │   │   ├── dashboard/   # 대시보드
│       │   │   ├── orders/      # 주문 관리
│       │   │   └── labels/      # 라벨 관리
│       │   ├── components/      # React 컴포넌트
│       │   │   ├── common/      # 공통 컴포넌트
│       │   │   ├── dashboard/   # 대시보드 컴포넌트
│       │   │   ├── orders/      # 주문 컴포넌트
│       │   │   ├── labels/      # 라벨 컴포넌트
│       │   │   └── ui/          # shadcn/ui 컴포넌트
│       │   ├── hooks/           # React 커스텀 훅
│       │   ├── lib/             # 유틸리티 및 API 클라이언트
│       │   └── types/           # TypeScript 타입 정의
│       ├── public/              # 정적 파일
│       │   └── manifest.json    # PWA manifest
│       ├── package.json
│       └── next.config.mjs
│
├── .env                         # 환경 변수 (git 제외)
├── .env.example                 # 환경 변수 템플릿
├── credentials.json             # Google API 인증 (git 제외)
├── pnpm-workspace.yaml          # pnpm 워크스페이스 설정
├── package.json                 # 루트 package.json
├── CLAUDE.md                    # Claude Code 가이드
└── README.md
```

## 아키텍처 및 데이터 흐름

### 전체 흐름

```
웹 브라우저 (Next.js)
    ↓ HTTP Request
REST API 서버 (Fastify)
    ↓ 서비스 호출
Core 비즈니스 로직
    ↓ Google Sheets API
구글 스프레드시트 ("감귤 주문서(응답)")
```

### 주문 조회 흐름

```
1. 웹 UI → GET /api/orders
   ↓
2. OrdersRoute → SheetService.getNewOrders()
   ↓ 비고 != "확인"인 새 주문 조회
   ↓ 한국어 타임스탬프 파싱 (오전/오후)
   ↓
3. sheetRowToOrder() → Order 객체 변환
   ↓ 전화번호 포맷팅 (010-XXXX-XXXX)
   ↓ 기본 발송인 정보 대체
   ↓
4. API Response → 웹 UI 렌더링
```

### 라벨 생성 흐름

```
1. 웹 UI → GET /api/labels/grouped
   ↓
2. LabelsRoute → SheetService.getNewOrders()
   ↓
3. LabelFormatter.formatLabels()
   ↓ 날짜별, 발송인별 그룹화
   ↓ 배송 라벨 포맷팅
   ↓ 주문 요약 생성 (5kg/10kg)
   ↓
4. API Response → 웹 UI 그리드 뷰 표시
```

### 주문 확인 흐름

```
1. 웹 UI → POST /api/orders/confirm
   ↓
2. OrdersRoute → SheetService.markOrdersAsConfirmed()
   ↓ 비고 컬럼에 "확인" 표시
   ↓
3. API Response → 캐시 무효화 → UI 업데이트
```

## API 엔드포인트

### 주문 관리
- `GET /api/orders` - 미확인 주문 목록 조회
- `GET /api/orders/summary` - 주문 요약 통계
- `GET /api/orders/stats/monthly` - 월별 주문 통계
- `POST /api/orders/confirm` - 전체 주문 확인 처리
- `POST /api/orders/:rowNumber/confirm` - 개별 주문 확인 처리

### 라벨 관리
- `GET /api/labels` - 배송 라벨 텍스트 조회
- `GET /api/labels/grouped` - 그룹화된 라벨 데이터 조회 (날짜/발송인별)

자세한 API 문서는 개발 서버 실행 후 http://localhost:3001/docs 에서 확인할 수 있습니다.

## 주요 기능 상세

### 1. 대시보드
- 미확인 주문 수, 총 매출, 상품별 수량 한눈에 확인
- 월별 매출 추이 차트 (Recharts)
- 최근 주문 목록
- 빠른 액션 (주문 관리, 라벨 생성)

### 2. 주문 관리
- 검색: 이름, 전화번호, 주소로 검색
- 필터링: 상품 타입별 (전체/5kg/10kg)
- 정렬: 날짜순/이름순
- 페이지네이션: 20건씩 표시
- CSV/Excel 다운로드
- 개별/일괄 주문 확인 처리

### 3. 라벨 관리
- **그리드 뷰**: 날짜/발송인별 그룹 카드 표시
- **필터링**: 날짜 및 발송인으로 검색
- **다중 선택**: 원하는 그룹만 선택
- **일괄 처리**: 선택된 그룹만 복사/출력/확인
- **접기/펼치기**: 각 그룹의 상세 주문 내역 토글
- **요약 정보**: 5kg/10kg 수량 및 금액 자동 계산

### 4. 전화번호 자동 포맷팅
- 10자리 숫자 → 11자리로 자동 변환 (010 접두사 추가)
- 11자리 010 번호 → 010-XXXX-XXXX 형식으로 변환

### 5. 발송인 정보 대체
- 주문서에 발송인 정보가 없거나 불완전한 경우
- `.env`에 설정된 `DEFAULT_SENDER` 정보를 자동으로 사용

### 6. 키보드 단축키
- `Alt + D`: 대시보드로 이동
- `Alt + O`: 주문 관리로 이동
- `Alt + L`: 라벨 관리로 이동
- `/`: 검색 입력란 포커스 (주문 페이지)

### 7. PWA 기능
- 오프라인 모드 지원
- 홈 화면에 앱 설치 가능
- Service Worker를 통한 캐싱

## 개발 워크플로우

### 브랜치 전략
- **개발 기본 브랜치**: `dev`
- 모든 피쳐는 `dev`를 base로 브랜치 생성
- 별도 지시가 없는 한 모든 피쳐는 `dev`로 머지
- **`main` 브랜치는 별도 지시 없이는 절대 수정 금지**

### 릴리즈 프로세스
- `dev` → `main` 머지 후 tag 생성
- Tag 형식: `v{major}.{minor}.{patch}` (예: v1.0.0, v1.2.3)

### 이슈 및 PR 관리
- **모든 작업은 GitHub 이슈로 먼저 생성**
- 진행사항은 이슈에서 트래킹 및 관리
- **피쳐 머지는 반드시 PR을 통해서만 진행**

### 코드 품질
```bash
# 린트 검사
pnpm lint

# 타입 체크
pnpm --filter @mytangerine/core type-check

# 테스트 실행
pnpm test

# 커버리지 확인
pnpm --filter @mytangerine/core test:coverage
```

더 자세한 개발 가이드는 [CLAUDE.md](./CLAUDE.md)를 참고하세요.

## 라이센스

이 프로젝트는 MIT 라이센스 하에 배포됩니다. 자세한 내용은 [LICENSE](./LICENSE) 파일을 참고하세요.

## 기여

이슈나 개선 사항이 있으면 GitHub 이슈로 등록해주세요.

---

Made with ❤️ for 🍊
