-- AlterTable
ALTER TABLE "carts" ADD COLUMN     "lastRecoveryAt" TIMESTAMP(3),
ADD COLUMN     "recoveryOptOut" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recoveryStage" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "paymentReminderAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "carts_recoveryStage_lastActivityAt_idx" ON "carts"("recoveryStage", "lastActivityAt");
