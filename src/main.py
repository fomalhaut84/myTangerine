from config.config import Config
from handlers.sheet_handler import GoogleSheetHandler
from handlers.order_processor import OrderProcessor
from formatters.label_formatter import LabelFormatter
from exceptions.exceptions import OrderProcessingError, SpreadsheetError, DataParsingError
from utils.logger import setup_logger, get_logger
import sys

class OrderManagementSystem:
    def __init__(self):
        self.config = Config()
        self.logger = get_logger(__name__)
        self.sheet_handler = GoogleSheetHandler(self.config)
        self.label_formatter = LabelFormatter(self.config)
        self.order_processor = OrderProcessor(self.config)

    def process_new_orders(self):
        try:
            self.logger.info("주문 처리 시작")
            new_orders = self.sheet_handler.get_new_orders()

            if not new_orders.empty:
                self.logger.info(f"{len(new_orders)}개의 새로운 주문 처리 중")
                formatted_labels = self.label_formatter.format_labels(new_orders)
                print(formatted_labels)

                # 모든 처리가 성공적으로 완료된 후에만 '확인' 표시
                self.sheet_handler.mark_orders_as_confirmed()
                self.logger.info("주문 처리 완료")
            else:
                self.logger.info("새로운 주문이 없습니다")
                print("새로운 주문이 없습니다.")

        except (OrderProcessingError, SpreadsheetError, DataParsingError) as e:
            self.logger.error(f"주문 처리 중 오류 발생: {str(e)}", exc_info=True)
            print(f"오류 발생: {str(e)}", file=sys.stderr)
            sys.exit(1)
        except Exception as e:
            self.logger.error(f"예상치 못한 오류 발생: {str(e)}", exc_info=True)
            print(f"예상치 못한 오류: {str(e)}", file=sys.stderr)
            sys.exit(1)

if __name__ == "__main__":
    # 루트 로거 설정
    setup_logger('root', log_file='logs/tangerine.log')
    system = OrderManagementSystem()
    system.process_new_orders()