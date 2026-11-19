-- Issue #251: 신규 주문 알림(hermes) 상태
-- 추가만 한다 — 기존 행은 NULL(알림 대상 아님)이라 지난 주문에 알림이 나가지 않는다

ALTER TABLE "orders" ADD COLUMN "new_order_notice" TEXT;
ALTER TABLE "orders" ADD COLUMN "new_order_notice_at" TIMESTAMP(3);

-- 알림 대기 조회
CREATE INDEX "orders_new_order_notice_idx" ON "orders"("new_order_notice");
