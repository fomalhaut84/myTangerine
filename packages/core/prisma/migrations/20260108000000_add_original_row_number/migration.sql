-- Issue #155: 배송사고 원본 주문 참조 필드 추가
-- claim 주문이 원본 주문을 참조할 수 있도록 original_row_number 컬럼 추가

ALTER TABLE "orders" ADD COLUMN "original_row_number" INTEGER;

-- 인덱스 추가 (원본 주문 조회 성능 향상)
CREATE INDEX "orders_original_row_number_idx" ON "orders"("original_row_number");
