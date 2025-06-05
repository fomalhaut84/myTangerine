from config.config import Config
from handlers.mongo_handler import MongoDBHandler
from handlers.order_processor import OrderProcessor
from formatters.label_formatter import LabelFormatter
from exceptions.exceptions import OrderProcessingError

class OrderManagementSystem:
    def __init__(self):
        self.config = Config()
        self.sheet_handler = MongoDBHandler(self.config)
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

if __name__ == "__main__":
    system = OrderManagementSystem()
    system.process_new_orders()
