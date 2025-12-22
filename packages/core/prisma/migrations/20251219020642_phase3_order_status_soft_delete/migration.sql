-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ALTER COLUMN "status" SET DEFAULT '신규주문';

-- CreateIndex
CREATE INDEX "orders_deleted_at_status_timestamp_idx" ON "orders"("deleted_at", "status", "timestamp");
