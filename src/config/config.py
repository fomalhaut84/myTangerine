import os
from dataclasses import dataclass
from typing import Dict
from dotenv import load_dotenv

# .env 파일 로드
load_dotenv()

@dataclass
class Config:
    # src의 상위 디렉토리(프로젝트 루트)를 ROOT_DIR로 설정
    ROOT_DIR:str = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    
    def __post_init__(self):
        # credentials.json 파일의 절대 경로 설정
        # 환경변수에서 경로를 읽거나 기본값 사용
        credentials_file = os.getenv('GOOGLE_CREDENTIALS_FILE', 'credentials.json')

        # 상대 경로인 경우 프로젝트 루트 기준으로 절대 경로 생성
        if not os.path.isabs(credentials_file):
            credentials_file = os.path.join(self.ROOT_DIR, credentials_file)

        self.CREDENTIALS_FILE = credentials_file
        self.CREDENTIALS_JSON = os.getenv('GOOGLE_CREDENTIALS_JSON')  # 선택적 JSON 문자열
        self.SPREADSHEET_NAME = "감귤 주문서(응답)"

        # 환경 변수에서 DEFAULT_SENDER 정보 로드
        self.DEFAULT_SENDER = {
            'address': os.getenv('DEFAULT_SENDER_ADDRESS', ''),
            'name': os.getenv('DEFAULT_SENDER_NAME', ''),
            'phone': os.getenv('DEFAULT_SENDER_PHONE', '')
        }

        self.PRODUCT_PRICES = {
            '5kg': 20000,
            '10kg': 35000
        }

        # 필수 컬럼 정의
        self.REQUIRED_COLUMNS = [
            '타임스탬프',
            '비고',
            '보내는분 성함',
            '보내는분 주소 (도로명 주소로 부탁드려요)',
            '보내는분 연락처 (핸드폰번호)',
            '받으실분 성함',
            '받으실분 주소 (도로명 주소로 부탁드려요)',
            '받으실분 연락처 (핸드폰번호)',
            '상품 선택',
            '수량'
        ]

        # DEFAULT_SENDER 값 검증
        if not all(self.DEFAULT_SENDER.values()):
            raise ValueError(
                "DEFAULT_SENDER 설정이 없습니다.\n"
                "1. .env.example을 .env로 복사\n"
                "2. .env 파일에 실제 정보를 입력하세요"
            )