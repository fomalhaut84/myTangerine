# myTangerine 🍊

감귤 주문을 처리하는 Python 기반 자동화 주문 관리 시스템

## 프로젝트 소개

myTangerine은 구글 스프레드시트에 접수된 감귤 주문을 자동으로 처리하여 배송 라벨을 생성하고 주문을 관리하는 시스템입니다. 주문 데이터를 가져와서 포맷팅된 배송 라벨을 출력하고, 처리된 주문을 자동으로 확인 상태로 표시합니다.

## 주요 기능

- 📊 **구글 스프레드시트 연동**: 실시간으로 새로운 주문 데이터 조회
- 🏷️ **배송 라벨 자동 생성**: 날짜와 발송인별로 그룹화된 배송 라벨 포맷팅
- 📱 **전화번호 자동 포맷팅**: 010-XXXX-XXXX 형식으로 자동 변환
- 📦 **주문 요약**: 5kg/10kg 박스별 수량 및 금액 집계
- ✅ **자동 확인 처리**: 처리 완료된 주문을 스프레드시트에 자동 표시
- 🔄 **중복 처리 방지**: 이미 확인된 주문은 재처리하지 않음

## 요구사항

- Python 3.6 이상
- Google Sheets API 서비스 계정
- 필수 Python 패키지:
  - `gspread`
  - `oauth2client`
  - `pandas`
  - `python-dotenv`

## 설치 및 설정

### 1. 환경 설정

`.env.example` 파일을 `.env`로 복사하고 기본 발송인 정보를 입력합니다:

```bash
cp .env.example .env
```

`.env` 파일 예시:
```
DEFAULT_SENDER_ADDRESS=제주도 제주시 정실3길 113 C동 301호
DEFAULT_SENDER_NAME=안세진
DEFAULT_SENDER_PHONE=010-6395-0618
```

### 2. Google Sheets API 인증 설정

1. [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트 생성
2. Google Sheets API 활성화
3. 서비스 계정 생성 및 JSON 키 다운로드
4. 다운로드한 JSON 파일을 프로젝트 루트에 `credentials.json`으로 저장
5. 서비스 계정 이메일에 구글 스프레드시트 편집 권한 부여

### 3. 의존성 설치

```bash
pip install gspread oauth2client pandas python-dotenv
```

## 사용 방법

### 기본 실행

```bash
python3 src/main.py
```

### 출력 예시

```
=== 2024-12-05 ===
보내는사람
제주도 제주시 정실3길 113 C동 301호 안세진 010-6395-0618

받는사람
서울시 강남구 테헤란로 123 홍길동 010-1234-5678
주문상품
5kg / 2박스

=======================================

==================================================
주문 요약
--------------------
5kg 주문: 10박스 (200,000원)
10kg 주문: 5박스 (175,000원)
--------------------
총 주문금액: 375,000원
```

## 프로젝트 구조

```
myTangerine/
├── src/
│   ├── config/          # 설정 관리
│   │   ├── __init__.py
│   │   └── config.py    # 환경 변수 로드 및 검증
│   ├── handlers/        # 데이터 처리
│   │   ├── __init__.py
│   │   ├── sheet_handler.py      # 구글 시트 API 처리
│   │   └── order_processor.py    # 주문 데이터 가공
│   ├── formatters/      # 출력 포맷팅
│   │   ├── __init__.py
│   │   └── label_formatter.py    # 배송 라벨 포맷팅
│   ├── exceptions/      # 커스텀 예외
│   │   ├── __init__.py
│   │   └── exceptions.py
│   └── main.py          # 메인 실행 파일
├── .env                 # 환경 변수 (git 제외)
├── .env.example         # 환경 변수 템플릿
├── credentials.json     # Google API 인증 (git 제외)
├── credentials.json.example  # 인증 파일 템플릿
├── CLAUDE.md            # Claude Code 가이드
└── README.md
```

## 데이터 흐름

```
1. GoogleSheetHandler.get_new_orders()
   ↓ 비고 != "확인"인 새 주문 조회
   ↓ 한국어 타임스탬프 파싱 (오전/오후)

2. LabelFormatter.format_labels()
   ↓ 날짜별, 발송인별 그룹화
   ↓ 배송 라벨 포맷팅
   ↓ 주문 요약 생성

3. GoogleSheetHandler.mark_orders_as_confirmed()
   ↓ 비고 컬럼에 "확인" 표시
```

## 주요 기능 상세

### 전화번호 포맷팅
- 10자리 숫자 → 11자리로 자동 변환 (010 접두사 추가)
- 11자리 010 번호 → 010-XXXX-XXXX 형식으로 변환

### 발송인 정보 대체
- 주문서에 발송인 정보가 없거나 불완전한 경우
- `.env`에 설정된 `DEFAULT_SENDER` 정보를 자동으로 사용

### 수량 처리
- '5kg 수량' 또는 '10kg 수량' 컬럼에서 숫자 자동 추출
- 수량 정보가 없으면 기본값 1 사용

## 개발 워크플로우

### 브랜치 전략
- 개발 기본 브랜치: `dev`
- 피쳐 브랜치는 `dev`에서 분기
- PR을 통해 `dev`로 머지
- 릴리즈는 `dev` → `main` 머지 후 태그 생성 (`v{major}.{minor}.{patch}`)

### GitHub 이슈 관리
- 모든 작업은 GitHub 이슈로 먼저 생성
- 진행사항은 이슈에서 트래킹

더 자세한 개발 가이드는 [CLAUDE.md](./CLAUDE.md)를 참고하세요.

## 라이센스

이 프로젝트는 MIT 라이센스 하에 배포됩니다. 자세한 내용은 [LICENSE](./LICENSE) 파일을 참고하세요.

## 기여

이슈나 개선 사항이 있으면 GitHub 이슈로 등록해주세요.

---

Made with ❤️ for 🍊
