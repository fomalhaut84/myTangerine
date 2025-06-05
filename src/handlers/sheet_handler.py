import gspread
from oauth2client.service_account import ServiceAccountCredentials
import pandas as pd
from datetime import datetime
from config.config import Config
from exceptions.exceptions import SpreadsheetError, DataParsingError

class GoogleSheetHandler:
    def __init__(self, config: Config):
        self.config = config
        self._setup_credentials()
        self.sheet = None  # sheet 인스턴스 변수 추가
        self.first_row_idx = None  # get_new_orders가 반환한 첫 행의 인덱스
        self.last_row_idx = None  # get_new_orders가 반환한 마지막 행의 인덱스

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

            # 반환할 첫 행과 마지막 행의 인덱스 저장
            self.first_row_idx = last_confirmed_idx + 1
            return df.iloc[self.first_row_idx:]
            
        except Exception as e:
            raise SpreadsheetError(f"Failed to get new orders: {str(e)}")
        
    def mark_orders_as_confirmed(self):
        """처리된 모든 행을 '확인'으로 표시"""
        try:
            if (
                self.sheet is not None
                and self.first_row_idx is not None
                and self.last_row_idx is not None
            ):
                비고_col = None
                for idx, col in enumerate(self.sheet.row_values(1)):
                    if col == '비고':
                        비고_col = idx + 1
                        break

                if 비고_col:
                    for row_idx in range(self.first_row_idx, self.last_row_idx):
                        self.sheet.update_cell(row_idx + 2, 비고_col, '확인')
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
