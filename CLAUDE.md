# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 언어 / Language

**이 프로젝트에서는 한국어로 대화를 진행합니다.** Claude Code와의 모든 커뮤니케이션은 한국어로 이루어지며, 세션이 재시작되더라도 한국어를 계속 사용해야 합니다.

**All communications in this project should be in Korean.** Even if the session restarts, continue using Korean.

## Development Workflow

### 브랜치 전략
- **개발 기본 브랜치**: `dev`
- 모든 피쳐는 `dev`를 base로 브랜치를 생성
- 별도 지시가 없는 한 모든 피쳐는 `dev`로 머지
- **`main` 브랜치는 별도 지시 없이는 절대 수정 금지**

### 릴리즈 프로세스
- `dev` → `main` 머지 후 tag 생성
- Tag 형식: `v{major}.{minor}.{patch}` (예: v1.0.0, v1.2.3)

### 이슈 및 PR 관리
- **모든 작업은 GitHub 이슈로 먼저 생성**
- 진행사항은 이슈에서 트래킹 및 관리
- **피쳐 머지는 반드시 PR을 통해서만 진행**

### 역할 분담
- **Claude Code**: 프로젝트 개발 담당 (코드 작성, 버그 수정, 기능 구현)
- **@codex-cli**: 문서화, 코드 분석, 코드 리뷰 담당
  - ⚠️ **@codex-cli는 코드를 직접 수정하면 안됨**

### 코드 리뷰 프로세스

Claude Code는 다음 프로세스를 자동으로 수행합니다:

1. **리뷰 요청**
   - 작업이 마무리되면 Claude Code가 스스로 @codex-cli에게 코드 리뷰를 요청
   - 리뷰 요청 시 작업 내용과 맥락을 명확히 전달

2. **리뷰 반영**
   - @codex-cli의 리뷰가 나오면 Claude Code가 스스로 피드백을 분석
   - 지적된 사항들을 코드에 반영하여 수정
   - 수정 완료 후 다시 @codex-cli에게 리뷰 요청

3. **리뷰 내역 문서화**
   - PR 생성 또는 커밋 시 다음 내용을 포함:
     - 받은 리뷰 사항 요약
     - 각 리뷰 사항에 대한 해결 방법
     - 반영하지 않은 사항이 있다면 그 이유
   - PR 본문이나 커밋 메시지에 리뷰 이력을 명확히 기록

**예시:**
```markdown
## 코드 리뷰 반영 내역

### @codex-cli 1차 리뷰
- [P1] REQUIRED_COLUMNS 오류: '수량' 대신 '5kg 수량', '10kg 수량' 사용 → 수정 완료
- [P2] 로깅 부족 → 중앙 집중식 로거 추가

### @codex-cli 2차 리뷰
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
