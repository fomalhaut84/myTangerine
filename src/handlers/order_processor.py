import logging
import pandas as pd
from config.config import Config

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
    def get_quantity(row: pd.Series, logger=None) -> int:
        try:
            if pd.notna(row['5kg 수량']) and str(row['5kg 수량']).strip():
                qty = str(row['5kg 수량'])
                if any(char.isdigit() for char in qty):
                    return int(''.join(filter(str.isdigit, qty)))
            
            elif pd.notna(row['10kg 수량']) and str(row['10kg 수량']).strip():
                qty = str(row['10kg 수량'])
                if any(char.isdigit() for char in qty):
                    return int(''.join(filter(str.isdigit, qty)))
            
            return 1  # 기본값
        except Exception as e:
            if logger:
                logger.error(f"Error processing quantity: {e}")
            return 1
