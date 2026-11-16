-- CreateEnum
CREATE TYPE "WithdrawalExemption" AS ENUM ('HYGIENE_UNSEALED', 'CUSTOM_MADE', 'PERISHABLE', 'SEALED_MEDIA', 'MIXED_INSEPARABLE');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('REQUESTED', 'ACCEPTED', 'RECEIVED', 'REFUNDED', 'REJECTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "withdrawalExemption" "WithdrawalExemption";

-- CreateTable
CREATE TABLE "withdrawal_requests" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "customerNote" TEXT,
    "rejectionReason" TEXT,
    "refundAmountCents" INTEGER NOT NULL DEFAULT 0,
    "refundShippingCents" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "handledBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withdrawal_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawal_items" (
    "id" TEXT NOT NULL,
    "withdrawalId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "refundCents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "withdrawal_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "withdrawal_requests_orderId_idx" ON "withdrawal_requests"("orderId");

-- CreateIndex
CREATE INDEX "withdrawal_requests_status_requestedAt_idx" ON "withdrawal_requests"("status", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_items_withdrawalId_orderItemId_key" ON "withdrawal_items"("withdrawalId", "orderItemId");

-- AddForeignKey
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_items" ADD CONSTRAINT "withdrawal_items_withdrawalId_fkey" FOREIGN KEY ("withdrawalId") REFERENCES "withdrawal_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
