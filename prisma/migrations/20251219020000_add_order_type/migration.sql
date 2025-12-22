-- Issue #131: Hybrid 모드에서 선물 주문 표시 문제 수정
-- order_type 컬럼 추가 (선물/판매 구분)

-- Add order_type column with default value 'customer'
ALTER TABLE "orders" ADD COLUMN "order_type" TEXT NOT NULL DEFAULT 'customer';

-- Create index for order_type filtering (optional, for performance)
CREATE INDEX "orders_order_type_idx" ON "orders"("order_type");
