-- CreateTable
CREATE TABLE "orders" (
    "id" SERIAL NOT NULL,
    "sheet_row_number" INTEGER,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "timestamp_raw" TEXT NOT NULL,
    "sender_name" TEXT NOT NULL,
    "sender_address" TEXT NOT NULL,
    "sender_phone" TEXT NOT NULL,
    "recipient_name" TEXT NOT NULL,
    "recipient_address" TEXT NOT NULL,
    "recipient_phone" TEXT NOT NULL,
    "product_selection" TEXT NOT NULL,
    "product_type" TEXT,
    "quantity_5kg" TEXT NOT NULL DEFAULT '',
    "quantity_10kg" TEXT NOT NULL DEFAULT '',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT '',
    "validation_error" TEXT,
    "sync_status" TEXT NOT NULL DEFAULT 'pending',
    "synced_at" TIMESTAMP(3),
    "sync_error_message" TEXT,
    "sync_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_logs" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER,
    "sheet_row_number" INTEGER,
    "status" TEXT NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 1,
    "error_message" TEXT,
    "error_stack" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_sheet_row_number_key" ON "orders"("sheet_row_number");

-- CreateIndex
CREATE INDEX "orders_status_timestamp_idx" ON "orders"("status", "timestamp");

-- CreateIndex
CREATE INDEX "orders_sync_status_sync_attempt_count_idx" ON "orders"("sync_status", "sync_attempt_count");

-- CreateIndex
CREATE INDEX "sync_logs_order_id_status_idx" ON "sync_logs"("order_id", "status");

-- CreateIndex
CREATE INDEX "sync_logs_sheet_row_number_status_idx" ON "sync_logs"("sheet_row_number", "status");

-- CreateIndex
CREATE INDEX "sync_logs_started_at_idx" ON "sync_logs"("started_at");

-- AddForeignKey
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
