from typing import List, Tuple
import pandas as pd
from config.config import Config
from handlers.order_processor import OrderProcessor

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

        # 안전한 컬럼 접근 with 기본값
        recipient_address = row.get('받으실분 주소 (도로명 주소로 부탁드려요)', '')
        recipient_name = row.get('받으실분 성함', '')
        recipient_phone = row.get('받으실분 연락처 (핸드폰번호)', '')

        labels.append(
            f"{recipient_address} "
            f"{recipient_name} "
            f"{OrderProcessor.format_phone_number(str(recipient_phone))}\n"
        )

        labels.append("주문상품\n")
        quantity = OrderProcessor.get_quantity(row)

        product_selection = str(row.get('상품 선택', ''))
        if '5kg' in product_selection:
            self.total_5kg += quantity
            labels.append(f"5kg / {quantity}박스\n\n")
        elif '10kg' in product_selection:
            self.total_10kg += quantity
            labels.append(f"10kg / {quantity}박스\n\n")

        return labels

    @staticmethod
    def _is_valid_sender(name: str, address: str, phone: str) -> bool:
        return all(
            pd.notna(field) and str(field).strip() != ''
            for field in (name, address, phone)
        )