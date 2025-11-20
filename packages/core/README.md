# @mytangerine/core

myTangerine 핵심 비즈니스 로직 패키지

## 설치

```bash
pnpm install
```

## 빌드

```bash
pnpm build
```

## 테스트

```bash
# 단위 테스트 실행
pnpm test

# 커버리지 포함
pnpm test:coverage
```

## 사용법

```typescript
import { Config, type Order } from '@mytangerine/core';

// 설정 로드
const config = new Config();

console.log(config.spreadsheetName); // "감귤 주문서(응답)"
console.log(config.defaultSender); // { name: "...", address: "...", phone: "..." }
```

## 구조

```
src/
├── config/           # 환경 변수 및 설정
├── types/            # TypeScript 타입 정의
├── services/         # Google Sheets API 서비스
├── formatters/       # 라벨 포맷팅
└── utils/            # 유틸리티 함수
```

## 개발

### 타입 체크

```bash
pnpm type-check
```

### 린트

```bash
pnpm lint
```

### 개발 모드 (watch)

```bash
pnpm dev
```

## 라이센스

MIT
