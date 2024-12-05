import gspread
from oauth2client.service_account import ServiceAccountCredentials
import pandas as pd
from datetime import datetime
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
import logging
from abc import ABC, abstractmethod

# 설정 클래스
@dataclass
class Config:
    CREDENTIALS_FILE: str = 'src/credentials.json'
    SPREADSHEET_NAME: str = "감귤 주문서(응답)"
    DEFAULT_SENDER: Dict[str, str] = None
    PRODUCT_PRICES: Dict[str, int] = None

    def __post_init__(self):
        self.DEFAULT_SENDER = {
            'address': '제주도 제주시 정실3길 113 C동 301호',
            'name': '안세진',
            'phone': '010-6395-0618'
        }
        self.PRODUCT_PRICES = {
            '5kg': 20000,
            '10kg': 35000
        }

# 예외 클래스들
class OrderProcessingError(Exception):
    """주문 처리 관련 기본 예외"""
    pass

class SpreadsheetError(OrderProcessingError):
    """스프레드시트 처리 관련 예외"""
    pass

class DataParsingError(OrderProcessingError):
    """데이터 파싱 관련 예외"""
    pass

# 주문 데이터 처리를 위한 기본 클래스
class OrderProcessor:
    def __init__(self, config: Config):
        self.config = config
        self.logger = self._setup_logger()
        
    def _setup_logger(self):
        logger = logging.getLogger(__name__)
        logger.setLevel(logging.INFO)
        if not logger.handlers:
            handler = logging.StreamHandler()
            formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
            handler.setFormatter(formatter)
            logger.addHandler(handler)
        return logger

    @staticmethod
    def format_phone_number(phone: str) -> str:
        if pd.isna(phone) or str(phone).strip() == '':
            return ''
        
        numbers_only = ''.join(filter(str.isdigit, str(phone)))
        
        if len(numbers_only) == 10 and numbers_only.startswith('10'):
            numbers_only = '0' + numbers_only
        
        if len(numbers_only) == 11 and numbers_only.startswith('010'):
            return f"{numbers_only[:3]}-{numbers_only[3:7]}-{numbers_only[7:]}"
        
        if len(str(phone).replace('-', '')) == 11 and str(phone).count('-') == 2:
            return phone
            
        return phone

    @staticmethod
    def get_quantity(row: pd.Series) -> int:
        if pd.notna(row['5kg 수량']):
            qty = str(row['5kg 수량'])
            if any(char.isdigit() for char in qty):
                return int(''.join(filter(str.isdigit, qty)))
        return 1

# 구글 스프레드시트 처리 클래스
class GoogleSheetHandler:
    def __init__(self, config: Config):
        self.config = config
        self._setup_credentials()
        self.sheet = None  # sheet 인스턴스 변수 추가
        self.last_row_idx = None

    def _setup_credentials(self):
        scope = ['https://spreadsheets.google.com/feeds', 'https://www.googleapis.com/auth/drive']
        try:
            credentials = ServiceAccountCredentials.from_json_keyfile_name(
                self.config.CREDENTIALS_FILE, scope
            )
            self.client = gspread.authorize(credentials)
        except Exception as e:
            raise SpreadsheetError(f"Failed to setup Google credentials: {str(e)}")

    def get_new_orders(self) -> pd.DataFrame:
        try:
            self.sheet = self.client.open(self.config.SPREADSHEET_NAME).sheet1  # 인스턴스 변수로 저장
            data = self.sheet.get_all_records()
            df = pd.DataFrame(data)

            # 마지막 행 인덱스 저장 (나중에 업데이트하기 위해)
            self.last_row_idx = len(df)            
            
            # 타임스탬프 처리
            df['타임스탬프'] = df['타임스탬프'].apply(self._parse_korean_timestamp)
            
            # 새 주문 필터링
            last_confirmed_idx = df[df['비고'] == '확인'].index[-1] if not df[df['비고'] == '확인'].empty else -1
            return df.iloc[last_confirmed_idx + 1:]
            
        except Exception as e:
            raise SpreadsheetError(f"Failed to get new orders: {str(e)}")
        
    def mark_orders_as_confirmed(self):
        """성공적으로 처리된 주문을 '확인'으로 표시"""
        try:
            if self.sheet and self.last_row_idx is not None:
                비고_col = None
                for idx, col in enumerate(self.sheet.row_values(1)):
                    if col == '비고':
                        비고_col = idx + 1
                        break
                
                if 비고_col:
                    self.sheet.update_cell(self.last_row_idx + 1, 비고_col, '확인')
                else:
                    raise SpreadsheetError("Could not find '비고' column")
        except Exception as e:
            raise SpreadsheetError(f"Failed to mark orders as confirmed: {str(e)}")

    @staticmethod
    def _parse_korean_timestamp(timestamp_str: str) -> datetime:
        try:
            am_pm = 'AM' if '오전' in timestamp_str else 'PM'
            timestamp_str = timestamp_str.replace('오전', 'AM').replace('오후', 'PM')
            
            parts = timestamp_str.replace('.', '').strip().split()
            year = parts[0]
            month = parts[1].zfill(2)
            day = parts[2].zfill(2)
            time = parts[4]
            
            formatted_str = f"{year}-{month}-{day} {am_pm} {time}"
            return pd.to_datetime(formatted_str, format='%Y-%m-%d %p %H:%M:%S')
        except Exception as e:
            raise DataParsingError(f"Failed to parse timestamp '{timestamp_str}': {str(e)}")

# 라벨 포맷팅 클래스
class LabelFormatter:
    def __init__(self, config: Config):
        self.config = config
        self.total_5kg = 0
        self.total_10kg = 0

    def format_labels(self, df: pd.DataFrame) -> str:
        if df.empty:
            return "새로운 주문이 없습니다."

        # 주문 처리 전 합계 초기화
        self.total_5kg = 0
        self.total_10kg = 0
        
        formatted_labels = []
        df = df.sort_values('타임스탬프')
        
        # 날짜별 그룹화 및 라벨 생성
        for date, date_group in df.groupby(df['타임스탬프'].dt.date):
            formatted_labels.append(f"=== {date} ===\n")
            
            # 보내는 사람별 그룹화
            sender_grouped = date_group.groupby([
                '보내는분 성함', 
                '보내는분 주소 (도로명 주소로 부탁드려요)', 
                '보내는분 연락처 (핸드폰번호)'
            ])
            
            # 보내는 사람별 처리
            first_sender = True
            for sender_info, sender_group in sender_grouped:
                if not first_sender:
                    formatted_labels.append("\n")
                
                formatted_labels.extend(self._format_sender_group(sender_info, sender_group))
                first_sender = False
            
            formatted_labels.append("="*39 + "\n\n")

        # 마지막에 총 주문 요약 추가
        formatted_labels.extend([
            "="*50 + "\n",
            "주문 요약\n",
            "-"*20 + "\n",
            f"5kg 주문: {self.total_5kg}박스 ({self.total_5kg * self.config.PRODUCT_PRICES['5kg']:,}원)\n",
            f"10kg 주문: {self.total_10kg}박스 ({self.total_10kg * self.config.PRODUCT_PRICES['10kg']:,}원)\n",
            "-"*20 + "\n",
            f"총 주문금액: {(self.total_5kg * self.config.PRODUCT_PRICES['5kg']) + (self.total_10kg * self.config.PRODUCT_PRICES['10kg']):,}원\n"
        ])

        return "".join(formatted_labels)

    def _format_sender_group(self, sender_info: Tuple, sender_group: pd.DataFrame) -> List[str]:
        sender_name, sender_address, sender_phone = sender_info
        labels = ["보내는사람\n"]
        
        if self._is_valid_sender(sender_name, sender_address, sender_phone):
            labels.append(
                f"{sender_address} {sender_name} "
                f"{OrderProcessor.format_phone_number(str(sender_phone))}\n\n"
            )
        else:
            labels.append(
                f"{self.config.DEFAULT_SENDER['address']} "
                f"{self.config.DEFAULT_SENDER['name']} "
                f"{self.config.DEFAULT_SENDER['phone']}\n\n"
            )
        
        for _, row in sender_group.iterrows():
            labels.extend(self._format_recipient(row))
        
        return labels

    def _format_recipient(self, row: pd.Series) -> List[str]:
        labels = ["받는사람\n"]
        labels.append(
            f"{row['받으실분 주소 (도로명 주소로 부탁드려요)']} "
            f"{row['받으실분 성함']} "
            f"{OrderProcessor.format_phone_number(str(row['받으실분 연락처 (핸드폰번호)']))}\n"
        )
        
        labels.append("주문상품\n")
        quantity = OrderProcessor.get_quantity(row)
        
        if '5kg' in str(row['상품 선택']):
            self.total_5kg += quantity
            labels.append(f"5kg / {quantity}박스\n\n")
        elif '10kg' in str(row['상품 선택']):
            self.total_10kg += quantity
            labels.append(f"10kg / {quantity}박스\n\n")
            
        return labels

    @staticmethod
    def _is_valid_sender(name: str, address: str, phone: str) -> bool:
        return all(
            pd.notna(field) and str(field).strip() != ''
            for field in (name, address, phone)
        )

# 메인 실행 클래스
class OrderManagementSystem:
    def __init__(self):
        self.config = Config()
        self.sheet_handler = GoogleSheetHandler(self.config)
        self.label_formatter = LabelFormatter(self.config)
        self.order_processor = OrderProcessor(self.config)

    def process_new_orders(self):
        try:
            new_orders = self.sheet_handler.get_new_orders()
            if not new_orders.empty:
                formatted_labels = self.label_formatter.format_labels(new_orders)
                print(formatted_labels)
                # 모든 처리가 성공적으로 완료된 후에만 '확인' 표시
                self.sheet_handler.mark_orders_as_confirmed()
            else:
                print("새로운 주문이 없습니다.")
        except OrderProcessingError as e:
            self.order_processor.logger.error(f"주문 처리 중 오류 발생: {str(e)}")
        except Exception as e:
            self.order_processor.logger.error(f"예상치 못한 오류 발생: {str(e)}")

# 실행
if __name__ == "__main__":
    system = OrderManagementSystem()
    system.process_new_orders()