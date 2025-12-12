# 데이터베이스 환경 구성 빠른 시작 가이드

> 이슈 #98 (주문 목록 PDF 내보내기) 및 기타 데이터베이스 기능 개발을 위한 빠른 시작 가이드

이 문서는 로컬 개발 환경 및 서버 환경에서 PostgreSQL 데이터베이스를 빠르게 구성하는 방법을 안내합니다.

더 자세한 내용은 [Phase 2.1 개발 환경 설정 가이드](./phase-2-1-setup-guide.md)를 참고하세요.

---

## 목차

1. [로컬 개발 환경 구성](#로컬-개발-환경-구성)
2. [서버 환경 구성](#서버-환경-구성)
3. [데이터베이스 확인](#데이터베이스-확인)
4. [샘플 데이터 생성](#샘플-데이터-생성)
5. [문제 해결](#문제-해결)

---

## 로컬 개발 환경 구성

### 사전 요구사항
- Node.js v22+
- pnpm v9+
- PostgreSQL 16+ 또는 Docker

### 방법 1: Homebrew (macOS)

```bash
# 1. PostgreSQL 설치
brew install postgresql@16

# 2. PostgreSQL 서비스 시작
brew services start postgresql@16

# 3. 데이터베이스 생성
createdb mytangerine

# 4. 접속 확인
psql mytangerine
```

### 방법 2: Docker (모든 OS)

```bash
# 1. docker-compose.yml 생성 (프로젝트 루트에)
cat > docker-compose.yml <<'EOF'
version: '3.8'
services:
  postgres:
    image: postgres:16-alpine
    container_name: mytangerine-postgres
    restart: always
    environment:
      POSTGRES_USER: mytangerine
      POSTGRES_PASSWORD: mytangerine_dev_2025
      POSTGRES_DB: mytangerine
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mytangerine"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
EOF

# 2. 컨테이너 시작
docker-compose up -d

# 3. 접속 확인
docker exec -it mytangerine-postgres psql -U mytangerine -d mytangerine
```

### 환경 변수 설정

```bash
# 1. .env 파일 생성
cp .env.example .env

# 2. DATABASE_URL 설정
# Homebrew 사용 시:
DATABASE_URL=postgresql://$(whoami):@localhost:5432/mytangerine?schema=public

# Docker 사용 시:
DATABASE_URL=postgresql://mytangerine:mytangerine_dev_2025@localhost:5432/mytangerine?schema=public
```

### Prisma 마이그레이션 적용

```bash
# 프로젝트 루트에서
pnpm install

# Prisma Client 생성 및 마이그레이션 적용
pnpm prisma:generate
pnpm prisma:migrate
```

**성공 메시지**:
```
Applying migration `20231212000000_init`
Database synchronized with Prisma schema
✔ Generated Prisma Client
```

---

## 서버 환경 구성

### Ubuntu/Debian 서버

```bash
# 1. PostgreSQL 설치
sudo apt update
sudo apt install -y postgresql-16 postgresql-contrib

# 2. PostgreSQL 시작 및 자동 시작 설정
sudo systemctl start postgresql
sudo systemctl enable postgresql

# 3. postgres 사용자로 전환
sudo -u postgres psql

# 4. 데이터베이스 및 사용자 생성 (psql 프롬프트에서)
CREATE DATABASE mytangerine;
CREATE USER mytangerine WITH ENCRYPTED PASSWORD 'your_secure_password_here';
GRANT ALL PRIVILEGES ON DATABASE mytangerine TO mytangerine;
GRANT ALL ON SCHEMA public TO mytangerine;
\q

# 5. 외부 접속 허용 (선택사항)
# /etc/postgresql/16/main/postgresql.conf 편집
sudo nano /etc/postgresql/16/main/postgresql.conf
# listen_addresses = '*' 추가

# /etc/postgresql/16/main/pg_hba.conf 편집
sudo nano /etc/postgresql/16/main/pg_hba.conf
# host    all             all             0.0.0.0/0               md5 추가

# PostgreSQL 재시작
sudo systemctl restart postgresql
```

### Docker (서버 환경)

```bash
# 1. Docker 및 Docker Compose 설치 확인
docker --version
docker-compose --version

# 2. docker-compose.yml 생성 (프로덕션용)
cat > docker-compose.yml <<'EOF'
version: '3.8'
services:
  postgres:
    image: postgres:16-alpine
    container_name: mytangerine-postgres-prod
    restart: always
    environment:
      POSTGRES_USER: mytangerine
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}  # .env에서 읽어옴
      POSTGRES_DB: mytangerine
    ports:
      - "127.0.0.1:5432:5432"  # 로컬만 접근
    volumes:
      - /var/lib/mytangerine/postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mytangerine"]
      interval: 30s
      timeout: 10s
      retries: 3
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

volumes:
  postgres_data:
EOF

# 3. .env 파일 생성
cat > .env <<'EOF'
POSTGRES_PASSWORD=your_secure_password_here
DATABASE_URL=postgresql://mytangerine:your_secure_password_here@localhost:5432/mytangerine?schema=public
EOF

# 4. 컨테이너 시작
docker-compose up -d

# 5. 로그 확인
docker-compose logs -f postgres
```

### 환경 변수 설정 (서버)

```bash
# 1. .env 파일 생성
nano .env

# 2. 다음 내용 추가
DATABASE_URL=postgresql://mytangerine:your_secure_password_here@localhost:5432/mytangerine?schema=public
PORT=3001
NODE_ENV=production
```

### 마이그레이션 적용 (서버)

```bash
# 1. 프로젝트 클론 또는 배포
git clone <repository-url>
cd myTangerine

# 2. 의존성 설치
pnpm install

# 3. Prisma 마이그레이션 (프로덕션 모드)
pnpm prisma:deploy

# 4. 확인
pnpm prisma:studio
```

---

## 데이터베이스 확인

### psql로 확인

```bash
# 로컬
psql mytangerine

# Docker
docker exec -it mytangerine-postgres psql -U mytangerine -d mytangerine
```

**확인 쿼리**:
```sql
-- 테이블 목록
\dt

-- orders 테이블 스키마
\d orders

-- 데이터 개수 확인
SELECT COUNT(*) FROM orders;
SELECT COUNT(*) FROM sync_logs;

-- 최근 주문 확인
SELECT id, sender_name, recipient_name, product_type, status, created_at
FROM orders
ORDER BY created_at DESC
LIMIT 5;
```

### Prisma Studio로 확인

```bash
# 프로젝트 루트에서
pnpm prisma:studio
```

브라우저에서 `http://localhost:5555` 접속하여 GUI로 데이터 확인

---

## 샘플 데이터 생성

### 방법 1: SQL 스크립트

```sql
-- 샘플 주문 데이터 삽입
INSERT INTO orders (
  sheet_row_number,
  timestamp,
  timestamp_raw,
  sender_name,
  sender_address,
  sender_phone,
  recipient_name,
  recipient_address,
  recipient_phone,
  product_selection,
  product_type,
  quantity_5kg,
  quantity_10kg,
  quantity,
  status,
  sync_status
) VALUES
  (2, NOW(), '2025. 12. 12. 오전 10:30:00', '안세진', '서울시 강남구', '010-6395-0618',
   '홍익선', '대전광역시 서구 월평중로 50, 전원아파트 101동 811호', '010-3034-5309',
   '10kg', '10kg', '', '1', 1, '', 'success'),
  (3, NOW(), '2025. 12. 12. 오전 10:31:00', '안세진', '서울시 강남구', '010-6395-0618',
   '안세준', '서울특별시 은평구 갈현로 7길 25, 센트레빌아스테리움 시그니처아파트 105동 707호', '010-9780-7902',
   '5kg', '5kg', '1', '', 1, '', 'success'),
  (4, NOW(), '2025. 12. 12. 오전 10:32:00', '장동수', '서울시 마포구', '010-2531-6493',
   '조희진', '서울 마포구 연남로5길 19-5 도서출판 인사이트', '010-6359-1271',
   '10kg', '10kg', '', '1', 1, '', 'success');
```

### 방법 2: Prisma Studio

1. `pnpm prisma:studio` 실행
2. `orders` 테이블 선택
3. "Add record" 버튼 클릭
4. 필드 입력 후 저장

### 방법 3: TypeScript 시드 스크립트

```typescript
// prisma/seed.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const orders = [
    {
      sheetRowNumber: 2,
      timestamp: new Date(),
      timestampRaw: '2025. 12. 12. 오전 10:30:00',
      senderName: '안세진',
      senderAddress: '서울시 강남구',
      senderPhone: '010-6395-0618',
      recipientName: '홍익선',
      recipientAddress: '대전광역시 서구 월평중로 50, 전원아파트 101동 811호',
      recipientPhone: '010-3034-5309',
      productSelection: '10kg',
      productType: '10kg',
      quantity5kg: '',
      quantity10kg: '1',
      quantity: 1,
      status: '',
      syncStatus: 'success',
    },
    // ... 더 추가
  ];

  for (const order of orders) {
    await prisma.order.create({ data: order });
  }

  console.log('Seed data created successfully');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

실행:
```bash
tsx prisma/seed.ts
```

---

## 문제 해결

### PostgreSQL 연결 실패

**증상**:
```
Error: P1001: Can't reach database server at localhost:5432
```

**해결**:
```bash
# PostgreSQL 실행 상태 확인
# Homebrew
brew services list | grep postgresql

# Docker
docker ps | grep postgres

# 포트 사용 확인
lsof -i :5432

# 재시작
brew services restart postgresql@16
# 또는
docker-compose restart
```

### 권한 오류

**증상**:
```
ERROR: permission denied for schema public
```

**해결**:
```sql
-- postgres 사용자로 접속하여
GRANT ALL ON SCHEMA public TO mytangerine;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO mytangerine;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO mytangerine;
```

### 마이그레이션 실패

**증상**:
```
Error: P3005: The database schema is not empty
```

**해결**:
```bash
# 개발 환경에서만 (주의: 모든 데이터 삭제됨)
pnpm prisma migrate reset

# 또는 수동으로 테이블 삭제 후 재시도
```

### Docker 컨테이너가 시작되지 않음

**확인**:
```bash
# 로그 확인
docker-compose logs postgres

# 컨테이너 상태 확인
docker ps -a

# 포트 충돌 확인
lsof -i :5432

# 기존 컨테이너 제거 후 재시작
docker-compose down
docker-compose up -d
```

---

## 다음 단계

데이터베이스 환경 구성이 완료되면:

1. **API 서버 시작**:
   ```bash
   pnpm --filter @mytangerine/api dev
   ```

2. **Sync Service 시작** (선택사항):
   ```bash
   pnpm --filter @mytangerine/sync-service dev
   ```

3. **Swagger UI 확인**:
   - http://localhost:3001/docs

4. **이슈 #98 작업 시작**:
   - PDF 생성 기능 개발
   - 샘플 데이터로 테스트

---

## 참고 자료

- **상세 가이드**: [Phase 2.1 개발 환경 설정 가이드](./phase-2-1-setup-guide.md)
- **Prisma 문서**: https://www.prisma.io/docs/
- **PostgreSQL 문서**: https://www.postgresql.org/docs/16/
- **Docker 문서**: https://docs.docker.com/

---

**작성일**: 2025-12-12
**버전**: 1.0.0
**관련 이슈**: #68, #98
