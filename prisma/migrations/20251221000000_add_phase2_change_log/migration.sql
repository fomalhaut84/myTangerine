-- Issue #136 Phase 2: 변경 이력 로그 + 충돌 감지

-- 1. Order 테이블에 버전 및 수정 추적 필드 추가
ALTER TABLE "orders" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "orders" ADD COLUMN "last_modified_by" TEXT;
ALTER TABLE "orders" ADD COLUMN "last_modified_at" TIMESTAMP(3);

-- 2. 충돌 감지용 인덱스 추가
CREATE INDEX "orders_last_modified_by_last_modified_at_idx" ON "orders"("last_modified_by", "last_modified_at");

-- 3. OrderChangeLog 테이블 생성
CREATE TABLE "order_change_logs" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "sheet_row_number" INTEGER NOT NULL,
    "changed_by" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "field_changes" JSONB NOT NULL,
    "previous_version" INTEGER NOT NULL,
    "new_version" INTEGER NOT NULL,
    "conflict_detected" BOOLEAN NOT NULL DEFAULT false,
    "conflict_resolution" TEXT,

    CONSTRAINT "order_change_logs_pkey" PRIMARY KEY ("id")
);

-- 4. OrderChangeLog 인덱스 생성
CREATE INDEX "order_change_logs_order_id_changed_at_idx" ON "order_change_logs"("order_id", "changed_at");
CREATE INDEX "order_change_logs_sheet_row_number_changed_at_idx" ON "order_change_logs"("sheet_row_number", "changed_at");
CREATE INDEX "order_change_logs_changed_by_changed_at_idx" ON "order_change_logs"("changed_by", "changed_at");
CREATE INDEX "order_change_logs_conflict_detected_changed_at_idx" ON "order_change_logs"("conflict_detected", "changed_at");

-- 5. OrderChangeLog -> Order 외래키 추가
ALTER TABLE "order_change_logs" ADD CONSTRAINT "order_change_logs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
