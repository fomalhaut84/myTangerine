-- Phase 3: 3단계 상태 체계 및 Soft Delete
-- tracking_number, deleted_at 컬럼 추가

-- Add tracking_number column
ALTER TABLE "orders" ADD COLUMN "tracking_number" TEXT;

-- Add deleted_at column for soft delete
ALTER TABLE "orders" ADD COLUMN "deleted_at" TIMESTAMP(3);

-- Update status default value ('' -> '신규주문')
-- 기존 빈 문자열 상태를 '신규주문'으로 변환
UPDATE "orders" SET "status" = '신규주문' WHERE "status" = '';

-- Update '확인' status to '배송완료' for backward compatibility
UPDATE "orders" SET "status" = '배송완료' WHERE "status" = '확인';

-- Alter default value for status column
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT '신규주문';

-- Create index for soft delete queries
CREATE INDEX "orders_deleted_at_status_timestamp_idx" ON "orders"("deleted_at", "status", "timestamp");
