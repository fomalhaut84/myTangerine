class OrderProcessingError(Exception):
    """주문 처리 관련 기본 예외"""
    pass

class SpreadsheetError(OrderProcessingError):
    """스프레드시트 처리 관련 예외"""
    pass

class DataParsingError(OrderProcessingError):
    """데이터 파싱 관련 예외"""
    pass