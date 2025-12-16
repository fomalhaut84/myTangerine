-- CreateTable
CREATE TABLE "distributed_locks" (
    "id" SERIAL NOT NULL,
    "lock_key" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "acquired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "distributed_locks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "distributed_locks_lock_key_key" ON "distributed_locks"("lock_key");

-- CreateIndex
CREATE INDEX "distributed_locks_lock_key_expires_at_idx" ON "distributed_locks"("lock_key", "expires_at");
