# Phase 2.1 개발 환경 설정 가이드
# Google Sheets → PostgreSQL 하이브리드 시스템

이 가이드는 Issue #68 Phase 2.1 (Week 1-4) 구현 결과물을 개발 환경에서 설정하고 실행하는 방법을 안내합니다.

## 목차

1. [사전 요구사항](#사전-요구사항)
2. [PostgreSQL 설치 및 설정](#postgresql-설치-및-설정)
3. [환경 변수 설정](#환경-변수-설정)
4. [Prisma 마이그레이션](#prisma-마이그레이션)
5. [패키지 빌드](#패키지-빌드)
6. [Sync Service 실행](#sync-service-실행)
7. [API 서버 실행](#api-서버-실행)
8. [확인 방법](#확인-방법)
9. [문제 해결](#문제-해결)

---

## 사전 요구사항

### 필수 소프트웨어
- **Node.js**: v22 이상
- **pnpm**: v9 이상
- **PostgreSQL**: v16 이상
- **Git**: 최신 버전

### 기존 설정
- Google Sheets API 인증 (credentials.json)
- 감귤 주문서 스프레드시트 접근 권한

---

## PostgreSQL 설치 및 설정

### macOS (Homebrew 사용)

```bash
# PostgreSQL 설치
brew install postgresql@16

# PostgreSQL 서비스 시작
brew services start postgresql@16

# 데이터베이스 생성
createdb mytangerine

# 접속 확인
psql mytangerine
```

### Docker 사용

```bash
# Docker Compose 파일 생성
cat > docker-compose.yml <<'EOF'
version: '3.8'
services:
  postgres:
    image: postgres:16-alpine
    container_name: mytangerine-postgres
    environment:
      POSTGRES_USER: mytangerine
      POSTGRES_PASSWORD: your_password_here
      POSTGRES_DB: mytangerine
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
EOF

# 컨테이너 시작
docker-compose up -d

# 접속 확인
docker exec -it mytangerine-postgres psql -U mytangerine -d mytangerine
```

---

## 환경 변수 설정

### 1. 루트 `.env` 파일 생성

```bash
# .env.example을 .env로 복사
cp .env.example .env
```

### 2. `.env` 파일 편집

```env
# API 서버 포트
PORT=3001

# 발송인 기본 정보
DEFAULT_SENDER_ADDRESS=your_address_here
DEFAULT_SENDER_NAME=your_name_here
DEFAULT_SENDER_PHONE=your_phone_here

# Google Sheets API 인증
GOOGLE_CREDENTIALS_FILE=credentials.json

# PostgreSQL 연결 정보 (Phase 2.1+)
DATABASE_URL=postgresql://mytangerine:your_password_here@localhost:5432/mytangerine?schema=public

# Sync Service 설정 (Phase 2.1+)
SYNC_INTERVAL="*/1 * * * *"  # cron 표현식 (1분마다)
SYNC_ENABLED=true             # 싱크 서비스 활성화 여부

# Data Source 선택 (sheets | database | hybrid)
DATA_SOURCE=sheets  # Phase 2.1에서는 sheets 유지
```

### 3. `packages/core/.env` 파일 생성

```bash
# packages/core/.env.example을 .env로 복사
cp packages/core/.env.example packages/core/.env
```

```env
# PostgreSQL 연결 정보
DATABASE_URL=postgresql://mytangerine:your_password_here@localhost:5432/mytangerine?schema=public
```

---

## Prisma 마이그레이션

### 1. Prisma Client 생성

```bash
cd packages/core
pnpm prisma:generate
```

### 2. 마이그레이션 실행

```bash
# 개발 모드 마이그레이션 (자동으로 마이그레이션 파일 생성 및 적용)
pnpm prisma:migrate

# 또는 프로덕션 배포용
pnpm prisma:deploy
```

### 3. 마이그레이션 확인

```bash
# Prisma Studio로 DB 확인
pnpm prisma:studio
```

브라우저에서 `http://localhost:5555`로 접속하여 테이블이 생성되었는지 확인합니다.

**확인할 테이블**:
- `orders`: 주문 데이터
- `sync_logs`: 싱크 로그

---

## 패키지 빌드

### 1. 전체 패키지 의존성 설치

```bash
# 프로젝트 루트에서
pnpm install
```

### 2. 개별 패키지 빌드

```bash
# core 패키지 빌드
pnpm --filter @mytangerine/core build

# sync-service 패키지 빌드
pnpm --filter @mytangerine/sync-service build

# api 패키지 빌드
pnpm --filter @mytangerine/api build
```

### 3. 전체 빌드 (권장)

```bash
# 프로젝트 루트에서
pnpm build
```

---

## Sync Service 실행

### 1. 개발 모드 (tsx 사용)

```bash
cd packages/sync-service
pnpm dev
```

**예상 출력**:
```
{"level":30,"time":"2025-12-12T...","msg":"Initializing Sync Service..."}
{"level":30,"time":"2025-12-12T...","msg":"SheetService initialized"}
{"level":30,"time":"2025-12-12T...","msg":"DatabaseService initialized"}
{"level":30,"time":"2025-12-12T...","msg":"SyncEngine initialized"}
{"level":30,"time":"2025-12-12T...","msg":"Starting polling scheduler..."}
{"level":30,"time":"2025-12-12T...","msg":"Polling scheduler started"}
{"level":30,"time":"2025-12-12T...","msg":"Sync Service started successfully"}
```

### 2. 프로덕션 모드

```bash
cd packages/sync-service
pnpm build
pnpm start
```

### 3. PM2로 백그라운드 실행 (권장)

```bash
# PM2 설치 (전역)
npm install -g pm2

# Sync Service 시작
pm2 start packages/sync-service/dist/index.js --name mytangerine-sync

# 로그 확인
pm2 logs mytangerine-sync

# 상태 확인
pm2 status
```

---

## API 서버 실행

### 1. 개발 모드

```bash
cd packages/api
pnpm dev
```

**예상 출력**:
```
[10:30:00] INFO: Prisma Client initialized
[10:30:00] INFO: Core services initialized (SheetService + DatabaseService)
[10:30:00] INFO: Server listening on http://0.0.0.0:3001
```

### 2. 프로덕션 모드

```bash
cd packages/api
pnpm build
pnpm start
```

---

## 확인 방법

### 1. API 서버 헬스 체크

```bash
curl http://localhost:3001/health
```

**예상 응답**:
```json
{
  "status": "ok",
  "timestamp": "2025-12-12T10:30:00.000Z",
  "version": "0.1.0"
}
```

### 2. Swagger UI 확인

브라우저에서 `http://localhost:3001/docs`로 접속하여 API 문서를 확인합니다.

### 3. 싱크 로그 확인

```bash
# Sync Service 로그 (PM2 사용 시)
pm2 logs mytangerine-sync

# 또는 개발 모드로 실행한 경우 콘솔 출력 확인
```

**1분마다 다음과 같은 로그가 출력되어야 합니다**:
```
{"level":30,"time":"...","msg":"Starting scheduled sync..."}
{"level":30,"time":"...","msg":"Fetched rows from Google Sheets","total":50}
{"level":30,"time":"...","msg":"Row synced successfully","rowNumber":2,"orderId":1}
...
{"level":30,"time":"...","msg":"Scheduled sync completed","success":48,"failed":0,"skipped":2}
```

### 4. 데이터베이스 확인

```bash
# Prisma Studio 실행
cd packages/core
pnpm prisma:studio
```

또는 `psql`로 직접 확인:

```bash
psql mytangerine

# 주문 개수 확인
SELECT COUNT(*) FROM orders;

# 최근 싱크된 주문 확인
SELECT id, "sheet_row_number", sender_name, sync_status, synced_at
FROM orders
ORDER BY synced_at DESC
LIMIT 10;

# 싱크 로그 확인
SELECT * FROM sync_logs ORDER BY started_at DESC LIMIT 10;
```

### 5. Google Sheets 확인

스프레드시트에 다음 컬럼이 추가되고 값이 채워지는지 확인:
- `DB_SYNC_STATUS`: `success` 또는 `fail`
- `DB_SYNC_AT`: 마지막 싱크 시각 (예: `2025-12-12 10:30:00`)
- `DB_SYNC_ID`: DB의 order ID (예: `123`)

---

## 문제 해결

### 1. PostgreSQL 연결 실패

**증상**:
```
Error: P1001: Can't reach database server at localhost:5432
```

**해결 방법**:
```bash
# PostgreSQL 실행 확인
brew services list | grep postgresql
# 또는 Docker
docker ps | grep postgres

# 포트 확인
lsof -i :5432

# 재시작
brew services restart postgresql@16
# 또는 Docker
docker-compose restart
```

### 2. Prisma 마이그레이션 실패

**증상**:
```
Error: P3009: Drift detected
```

**해결 방법**:
```bash
# 마이그레이션 상태 확인
cd packages/core
pnpm prisma migrate status

# DB 초기화 (개발 환경만)
pnpm prisma migrate reset

# 다시 마이그레이션
pnpm prisma:migrate
```

### 3. Sync Service가 시작되지 않음

**증상**:
```
Error: Cannot find module '@mytangerine/core'
```

**해결 방법**:
```bash
# 의존성 재설치
pnpm install

# core 패키지 빌드
pnpm --filter @mytangerine/core build

# sync-service 패키지 빌드
pnpm --filter @mytangerine/sync-service build
```

### 4. Google Sheets API 인증 오류

**증상**:
```
Error: The caller does not have permission
```

**해결 방법**:
1. `credentials.json` 파일이 프로젝트 루트에 있는지 확인
2. 서비스 계정이 스프레드시트 공유 권한을 가지고 있는지 확인
3. `.env`의 `GOOGLE_CREDENTIALS_FILE` 경로 확인

### 5. 싱크가 동작하지 않음

**체크리스트**:
- [ ] `.env`의 `SYNC_ENABLED=true` 확인
- [ ] `SYNC_INTERVAL` cron 표현식 유효성 확인 (https://crontab.guru)
- [ ] Sync Service 로그 확인
- [ ] Google Sheets API 할당량 확인

---

## 다음 단계

Week 1-4 완료 후:
1. ✅ Prisma 인프라 설정
2. ✅ DatabaseService 구현
3. ✅ Sync Service 구현
4. ✅ API 통합

**후속 작업** (별도 PR):
- Week 3-4 피드백 반영
- 전체 워크플로우 테스트
- 성능 테스트 및 최적화

---

## 참고 자료

- [Issue #68](https://github.com/fomalhaut84/myTangerine/issues/68): 아키텍처 전환 계획
- [Prisma 공식 문서](https://www.prisma.io/docs/)
- [Fastify 플러그인 가이드](https://fastify.dev/docs/latest/Reference/Plugins/)
- [node-cron 문법](https://github.com/node-cron/node-cron)

---

**작성자**: Claude Sonnet 4.5
**작성일**: 2025-12-12
**버전**: 1.0.0
