# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 언어 / Language

**이 프로젝트에서는 한국어로 대화를 진행합니다.** Claude Code와의 모든 커뮤니케이션은 한국어로 이루어지며, 세션이 재시작되더라도 한국어를 계속 사용해야 합니다.

**All communications in this project should be in Korean.** Even if the session restarts, continue using Korean.

## Development Workflow

### 브랜치 전략

```
main (production)     ←─── 릴리즈 버전, 태그 생성
  │
  │  ↑ PR (릴리즈)     ↓ 핫픽스 머지
  │
dev (development)     ←─── 개발 기본 브랜치
  │
  │  ↑ PR (피쳐)
  │
feature/*             ←─── 피쳐 브랜치 (dev base)
hotfix/*              ←─── 핫픽스 브랜치 (main base)
```

#### 핵심 규칙
- **개발 기본 브랜치**: `dev`
- ⚠️ **피쳐는 반드시 `dev`를 base로 생성** - main으로 직접 머지되는 피쳐 브랜치 금지
- **핫픽스만 `main`을 base로 생성** 가능
- **`main` 브랜치 직접 커밋 금지** - 반드시 PR을 통해서만 변경

#### 브랜치 네이밍
- 피쳐: `feature/issue-{번호}-{설명}` (예: `feature/issue-155-claim-db-only`)
- 핫픽스: `hotfix/issue-{번호}-{설명}` (예: `hotfix/issue-160-login-fix`)
- 릴리즈: `release/v{버전}` (예: `release/v1.0.0`) - 필요시 사용

### 버전 관리

#### 버전 넘버링 규칙
- **형식**: `v{메이저}.{마이너}.{패치}` (Semantic Versioning)
- **초기 버전**: `v1.0.0`
- **예시**: v1.0.0, v1.1.0, v1.1.1, v2.0.0

| 버전 타입 | 변경 시점 | 예시 |
|-----------|----------|------|
| **메이저** | 호환성이 깨지는 대규모 변경 | v1.0.0 → v2.0.0 |
| **마이너** | 하위 호환 가능한 새 기능 추가 | v1.0.0 → v1.1.0 |
| **패치** | 버그 수정, 핫픽스 | v1.0.0 → v1.0.1 |

### 릴리즈 프로세스

#### 피쳐 릴리즈 (일반 개발)

```
1. 피쳐 개발
   feature/* ──PR──→ dev (머지)

2. 릴리즈 준비
   dev ──PR──→ main (릴리즈 PR 생성)

3. 릴리즈 완료
   main 머지 → 버전 태그 생성 (v1.x.x)
```

**상세 절차:**
1. `dev`에서 피쳐 브랜치 생성 → 개발 → PR → `dev` 머지
2. 릴리즈 시점에 `dev` → `main` PR 생성
3. PR 리뷰 후 `main`에 머지
4. `main`에서 버전 태그 생성: `git tag v1.x.x && git push origin v1.x.x`

#### 핫픽스 릴리즈 (긴급 수정)

```
1. 핫픽스 개발
   main ──branch──→ hotfix/* ──PR──→ main (머지)

2. 패치 버전 태그
   main 머지 → 버전 태그 생성 (v1.0.x)

3. dev 동기화 (필수!)
   main ──merge──→ dev
```

**상세 절차:**
1. `main`에서 핫픽스 브랜치 생성: `git checkout -b hotfix/issue-xxx main`
2. 버그 수정 → PR → `main` 머지
3. `main`에서 패치 버전 태그 생성: `git tag v1.0.x && git push origin v1.0.x`
4. ⚠️ **필수**: `main` 변경사항을 `dev`에 머지하여 동기화
   ```bash
   git checkout dev
   git merge main
   git push origin dev
   ```

### 태그 생성 방법

```bash
# 태그 생성
git tag -a v1.0.0 -m "Release v1.0.0: 초기 정식 릴리즈"

# 원격에 푸시
git push origin v1.0.0

# 모든 태그 푸시
git push origin --tags
```

### GitHub Release 생성 (선택)

```bash
# GitHub CLI로 릴리즈 생성
gh release create v1.0.0 --title "v1.0.0" --notes "## 주요 변경사항
- 기능 A 추가
- 버그 B 수정"
```

### 이슈 및 PR 관리
- **모든 작업은 GitHub 이슈로 먼저 생성**
- 진행사항은 이슈에서 트래킹 및 관리
- **피쳐 머지는 반드시 PR을 통해서만 진행**
- ⚠️ **PR 머지는 사용자가 직접 수행** - Claude Code는 PR 생성까지만 담당
- ⚠️ **이슈/PR 본문은 반드시 codex-cli가 작성** - Claude Code가 직접 작성하지 않음
  - 이슈 생성 시: codex-cli에게 본문 작성 요청 → 결과를 `gh issue create`로 등록
  - PR 생성 시: codex-cli에게 본문 작성 요청 → 결과를 `gh pr create`로 등록
- **GitHub 이슈/PR/코멘트에서 codex-cli 언급 시**:
  - ⚠️ `@` 기호를 **사용하지 말 것** (GitHub에서 멘션으로 인식됨)
  - ✅ 올바른 표기: "codex-cli 코드 리뷰 통과"
  - ❌ 잘못된 표기: "@codex-cli 코드 리뷰 통과"

### 역할 분담
- **Claude Code**: 프로젝트 개발 담당 (코드 작성, 버그 수정, 기능 구현)
- **codex-cli**: 문서화, 코드 분석, 코드 리뷰 담당
  - ⚠️ **codex-cli는 코드를 직접 수정하면 안됨**
  - ⚠️ **codex-cli는 읽기 전용 환경**에서 실행되므로 일부 작업 제한:
    - GitHub API 직접 접근 불가
    - 파일 시스템 직접 읽기 불가
    - 테스트/빌드/명령어 실행 불가

### 문서화 작업 워크플로우

codex-cli가 읽기 전용 환경이므로, 다음 워크플로우를 따릅니다:

1. **Claude Code가 데이터 수집**
   - GitHub 이슈/PR/코멘트 읽기 (`gh` CLI 또는 WebFetch)
   - 코드 파일 읽기 (Read 도구)
   - 필요한 모든 정보를 수집

2. **Claude Code가 codex-cli에게 정보 전달**
   - 수집한 정보를 codex-cli에게 명확히 전달
   - 분석 또는 문서 작성 요청

3. **codex-cli가 분석 및 문서 작성**
   - 받은 정보를 바탕으로 분석 수행
   - 이슈 본문, PR 본문, 코멘트 내용 등을 작성
   - 결과를 Claude Code에게 반환

4. **Claude Code가 결과 등록**
   - codex-cli가 작성한 내용을 GitHub에 등록 (이슈 생성, PR 생성, 코멘트 작성 등)
   - 출처 표시: "codex-cli 분석 기반으로 작성됨" (@ 기호 없이!)

**예시:**
```
사용자: "GitHub 이슈 #13 확인해서 Phase 3.1 이슈 만들어줘"

1. Claude Code: gh issue view 13 --comments 실행하여 내용 읽기
2. Claude Code: codex-cli에게 이슈 내용 전달 및 Phase 3.1 이슈 본문 작성 요청
3. codex-cli: 분석 후 이슈 본문 작성하여 반환
4. Claude Code: gh issue create로 이슈 생성 (본문에 "codex-cli 분석 기반으로 작성됨" 표시)
```

### 코드 리뷰 프로세스

Claude Code는 다음 프로세스를 자동으로 수행합니다:

1. **리뷰 요청**
   - 작업이 마무리되면 Claude Code가 스스로 codex-cli에게 코드 리뷰를 요청
   - 리뷰 요청 시 작업 내용과 맥락을 명확히 전달
   - ⚠️ **codex-cli 호출 방법**: `mcp__codex-cli__codex` (prompt) 사용
     - ✅ 올바른 방법: `mcp__codex-cli__codex` with prompt 파라미터
     - ❌ 잘못된 방법: `mcp__codex-cli__review` (동작하지 않음)

2. **리뷰 반영**
   - codex-cli의 리뷰가 나오면 Claude Code가 스스로 피드백을 분석
   - 지적된 사항들을 코드에 반영하여 수정
   - 수정 완료 후 다시 codex-cli에게 리뷰 요청

3. **테스트 및 빌드 실행**
   - codex-cli는 읽기 전용 환경이라 테스트, 빌드 등을 직접 실행할 수 없음
   - Claude Code가 대신 다음 작업을 수행하고 결과를 codex-cli에게 공유:
     - 의존성 설치 (`pnpm install`, `npm install` 등)
     - 빌드 실행 (`pnpm build`, `npm run build` 등)
     - 테스트 실행 (`pnpm test`, `npm test` 등)
     - 린트 체크 (`pnpm lint` 등)
   - 실행 결과(성공/실패, 에러 메시지, 경고 등)를 codex-cli에게 명확히 전달
   - 빌드/테스트 에러 발생 시 수정 후 다시 실행하여 결과 공유

4. **리뷰 내역 문서화**
   - PR 생성 또는 커밋 시 다음 내용을 포함:
     - 받은 리뷰 사항 요약
     - 각 리뷰 사항에 대한 해결 방법
     - 반영하지 않은 사항이 있다면 그 이유
   - PR 본문이나 커밋 메시지에 리뷰 이력을 명확히 기록

**예시:**
```markdown
## 코드 리뷰 반영 내역

### codex-cli 1차 리뷰
- [P1] REQUIRED_COLUMNS 오류: '수량' 대신 '5kg 수량', '10kg 수량' 사용 → 수정 완료
- [P2] 로깅 부족 → 중앙 집중식 로거 추가

### codex-cli 2차 리뷰
- 추가 이슈 없음 ✅
```

## 프로젝트 개요

myTangerine은 구글 스프레드시트의 감귤 주문을 처리하는 Python 기반 주문 관리 시스템입니다. 새로운 주문을 가져와서 배송 라벨을 포맷팅하고, 주문 요약을 계산하며, 처리된 주문을 확인 상태로 표시합니다.

## 애플리케이션 실행

```bash
# 메인 주문 처리 스크립트 실행
python3 src/main.py
```

스크립트 실행 시 수행되는 작업:
1. 구글 스프레드시트에서 미확인 주문 가져오기
2. 날짜와 보내는 사람별로 그룹화된 배송 라벨 포맷팅 및 출력
3. 총 수량과 가격이 포함된 주문 요약 출력
4. 처리된 주문을 스프레드시트에 "확인"으로 표시

## 초기 설정

1. `.env.example`을 `.env`로 복사하고 기본 발송인 정보를 입력:
   ```bash
   cp .env.example .env
   ```

2. Google Sheets API 인증 정보를 가져와 프로젝트 루트에 `credentials.json`으로 저장:
   - 인증 파일은 서비스 계정 JSON 키여야 함
   - `credentials.json.example`을 구조 참고용으로 사용

3. 서비스 계정에 "감귤 주문서(응답)" 이름의 구글 스프레드시트 접근 권한 부여

## 아키텍처

### 모듈 구조

코드베이스는 `src/` 아래 4개의 주요 패키지로 구성됩니다:

- **config/** - 환경 변수를 사용한 설정 관리
- **handlers/** - 데이터 조회 및 처리 로직
- **formatters/** - 배송 라벨 포맷팅
- **exceptions/** - 커스텀 예외 계층 구조

### 데이터 흐름

```
src/main.py (OrderManagementSystem)
    ↓
GoogleSheetHandler.get_new_orders()
    → 비고 != "확인"인 행들을 가져옴
    → 한국어 타임스탬프 파싱 (오전/오후)
    → 새 주문의 DataFrame 반환
    ↓
LabelFormatter.format_labels()
    → 날짜별, 보내는 사람별로 그룹화
    → 수취인 라벨을 주소/전화번호와 함께 포맷팅
    → 5kg, 10kg 수량 추적
    → 주문 요약 생성
    ↓
GoogleSheetHandler.mark_orders_as_confirmed()
    → 비고 컬럼을 "확인"으로 업데이트
```

### 주요 클래스

- **Config** (`src/config/config.py`): 환경 변수를 로드하고 상품 가격을 정의. 초기화 시 DEFAULT_SENDER 설정을 검증함.

- **GoogleSheetHandler** (`src/handlers/sheet_handler.py`): Google Sheets API 상호작용을 관리. OAuth2 서비스 계정 인증 정보로 인증함.

- **OrderProcessor** (`src/handlers/order_processor.py`): 전화번호 포맷팅과 수량 추출 유틸리티. 포매터들에서 사용하는 정적 메서드들.

- **LabelFormatter** (`src/formatters/label_formatter.py`): 포맷팅된 배송 라벨을 생성. 발송인 정보가 누락되거나 유효하지 않을 때 DEFAULT_SENDER로 대체함.

- **OrderManagementSystem** (`src/main.py`): 전체 주문 처리 워크플로우를 조율함.

### 설정 시스템

환경 변수는 프로젝트 루트의 `.env`에서 로드됩니다 (`src/` 내부가 아님). Config 클래스는:
- `ROOT_DIR`을 사용하여 프로젝트 루트의 `credentials.json` 위치 파악
- 환경 변수에서 DEFAULT_SENDER 로드
- 필수 환경 변수가 없으면 ValueError 발생

### 레거시 코드

프로젝트 루트의 `getLabel.py`는 이전 버전의 모노리식 애플리케이션입니다. `src/` 아래의 현재 아키텍처는 리팩토링된 모듈화 버전입니다.

## 한국어 컬럼명

구글 스프레드시트와 코드에서 사용하는 한국어 컬럼명:
- 타임스탬프 = Timestamp
- 비고 = Remarks/Notes
- 보내는분 = Sender
- 받으실분 = Recipient
- 상품 선택 = Product Selection
- 수량 = Quantity

타임스탬프는 한국어 오전/오후 표기를 사용하며, 이는 파싱되어 datetime 객체로 변환됩니다.

## 의존성

사용하는 주요 Python 패키지:
- `gspread` - Google Sheets API 클라이언트
- `oauth2client` - Google OAuth2 인증
- `pandas` - 데이터 조작 및 분석
- `python-dotenv` - 환경 변수 관리
