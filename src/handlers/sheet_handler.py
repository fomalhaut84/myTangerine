import gspread
from oauth2client.service_account import ServiceAccountCredentials
import pandas as pd
from datetime import datetime
import logging
import json
import tempfile
import os
from config.config import Config
from exceptions.exceptions import SpreadsheetError, DataParsingError
from utils.logger import get_logger

class GoogleSheetHandler:
    def __init__(self, config: Config):
        self.config = config
        self.logger = get_logger(__name__)
        self._setup_credentials()
        self.sheet = None  # sheet 인스턴스 변수 추가
        self.new_order_rows = []  # 처리한 행들의 실제 인덱스 저장

    def _setup_credentials(self):
        scope = ['https://spreadsheets.google.com/feeds', 'https://www.googleapis.com/auth/drive']
        try:
            # GOOGLE_CREDENTIALS_JSON 환경변수가 있으면 JSON 문자열에서 로드
            if self.config.CREDENTIALS_JSON:
                self.logger.info("환경변수에서 Google Sheets API 인증 정보 로드")
                credentials_dict = json.loads(self.config.CREDENTIALS_JSON)
                credentials = ServiceAccountCredentials.from_json_keyfile_dict(
                    credentials_dict, scope
                )
            else:
                # 파일에서 로드
                self.logger.info(f"파일에서 Google Sheets API 인증 정보 로드: {self.config.CREDENTIALS_FILE}")
                if not os.path.exists(self.config.CREDENTIALS_FILE):
                    raise FileNotFoundError(
                        f"인증 파일을 찾을 수 없습니다: {self.config.CREDENTIALS_FILE}\n"
                        f"1. credentials.json 파일을 준비하거나\n"
                        f"2. GOOGLE_CREDENTIALS_FILE 환경변수로 경로를 지정하거나\n"
                        f"3. GOOGLE_CREDENTIALS_JSON 환경변수에 JSON 내용을 설정하세요"
                    )
                credentials = ServiceAccountCredentials.from_json_keyfile_name(
                    self.config.CREDENTIALS_FILE, scope
                )

            self.client = gspread.authorize(credentials)
            self.logger.info("Google Sheets API 인증 완료")
        except FileNotFoundError as e:
            self.logger.error(str(e))
            raise SpreadsheetError(str(e))
        except json.JSONDecodeError as e:
            self.logger.error(f"JSON 파싱 오류: {str(e)}", exc_info=True)
            raise SpreadsheetError(f"Invalid JSON in credentials: {str(e)}")
        except Exception as e:
            self.logger.error(f"Google Sheets API 인증 실패: {str(e)}", exc_info=True)
            raise SpreadsheetError(f"Failed to setup Google credentials: {str(e)}")

    def _validate_required_columns(self, df: pd.DataFrame):
        """필수 컬럼의 존재 여부를 검증"""
        required_columns = self.config.REQUIRED_COLUMNS
        missing_columns = [col for col in required_columns if col not in df.columns]

        if missing_columns:
            raise DataParsingError(
                f"스프레드시트에 필수 컬럼이 없습니다: {', '.join(missing_columns)}\n"
                f"필요한 컬럼: {', '.join(required_columns)}"
            )

    def get_new_orders(self) -> pd.DataFrame:
        try:
            self.logger.info(f"스프레드시트 '{self.config.SPREADSHEET_NAME}' 열기")
            self.sheet = self.client.open(self.config.SPREADSHEET_NAME).sheet1
            data = self.sheet.get_all_records()
            df = pd.DataFrame(data)
            self.logger.info(f"총 {len(df)}개의 행 로드 완료")

            # 필수 컬럼 검증
            self._validate_required_columns(df)

            # 타임스탬프 처리
            if '타임스탬프' in df.columns:
                df['타임스탬프'] = df['타임스탬프'].apply(self._parse_korean_timestamp)

            # 새 주문 필터링
            last_confirmed_idx = df[df['비고'] == '확인'].index[-1] if not df[df['비고'] == '확인'].empty else -1
            new_orders_df = df.iloc[last_confirmed_idx + 1:]

            # 처리할 행들의 실제 스프레드시트 행 번호 저장 (헤더 행 고려하여 +2)
            self.new_order_rows = [idx + 2 for idx in new_orders_df.index]

            self.logger.info(f"새로운 주문 {len(new_orders_df)}개 발견")
            return new_orders_df

        except (SpreadsheetError, DataParsingError) as e:
            self.logger.error(f"주문 조회 중 에러: {str(e)}", exc_info=True)
            raise
        except Exception as e:
            self.logger.error(f"예상치 못한 에러 발생: {str(e)}", exc_info=True)
            raise SpreadsheetError(f"Failed to get new orders: {str(e)}")
        
    def mark_orders_as_confirmed(self):
        """성공적으로 처리된 주문을 '확인'으로 표시"""
        try:
            if not self.sheet or not self.new_order_rows:
                self.logger.info("처리할 행이 없습니다")
                return  # 처리할 행이 없으면 종료

            # '비고' 컬럼 찾기
            비고_col = None
            for idx, col in enumerate(self.sheet.row_values(1)):
                if col == '비고':
                    비고_col = idx + 1
                    break

            if not 비고_col:
                self.logger.error("'비고' 컬럼을 찾을 수 없습니다")
                raise SpreadsheetError("Could not find '비고' column")

            # 모든 새 주문 행을 '확인'으로 업데이트
            self.logger.info(f"{len(self.new_order_rows)}개 행을 '확인'으로 업데이트 시작")
            for row_num in self.new_order_rows:
                self.sheet.update_cell(row_num, 비고_col, '확인')
                self.logger.debug(f"행 {row_num} 업데이트 완료")

            self.logger.info(f"{len(self.new_order_rows)}개 행 업데이트 완료")

        except Exception as e:
            self.logger.error(f"주문 확인 처리 실패: {str(e)}", exc_info=True)
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