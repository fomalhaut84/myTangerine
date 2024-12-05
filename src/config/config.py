import os
from dataclasses import dataclass
from typing import Dict

@dataclass
class Config:
    # 프로젝트의 루트 디렉토리 경로 설정
    ROOT_DIR: str = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    def __post_init__(self):
        # credentials.json 파일의 절대 경로 설정
        self.CREDENTIALS_FILE = os.path.join(self.ROOT_DIR, 'credentials.json')
        
        self.SPREADSHEET_NAME = "감귤 주문서(응답)"
        self.DEFAULT_SENDER = {
            'address': '제주도 제주시 정실3길 113 C동 301호',
            'name': '안세진',
            'phone': '010-6395-0618'
        }
        self.PRODUCT_PRICES = {
            '5kg': 20000,
            '10kg': 35000
        }