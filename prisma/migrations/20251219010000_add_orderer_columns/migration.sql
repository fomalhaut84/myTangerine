-- Phase 3: 주문자 정보 컬럼 추가
-- orderer_name, orderer_email 컬럼 추가

-- Add orderer_name column (주문자 성함)
ALTER TABLE "orders" ADD COLUMN "orderer_name" TEXT;

-- Add orderer_email column (주문자 이메일)
ALTER TABLE "orders" ADD COLUMN "orderer_email" TEXT;
