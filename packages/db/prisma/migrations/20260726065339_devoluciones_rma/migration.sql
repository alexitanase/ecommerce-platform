-- CreateEnum
CREATE TYPE "ReturnReason" AS ENUM ('DEFECTIVE', 'NOT_AS_DESCRIBED', 'DAMAGED_IN_TRANSIT', 'WRONG_ITEM', 'MISSING_ITEM', 'WITHDRAWAL');

-- CreateEnum
CREATE TYPE "ReturnResolution" AS ENUM ('REPAIR', 'REPLACE', 'REFUND', 'PRICE_REDUCTION', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'APPROVED', 'IN_RETURN', 'RECEIVED', 'RESOLVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "return_requests" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "reason" "ReturnReason" NOT NULL,
    "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "resolution" "ReturnResolution",
    "customerNote" TEXT,
    "photoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "returnShippingPaidBy" TEXT NOT NULL DEFAULT 'customer',
    "refundAmountCents" INTEGER NOT NULL DEFAULT 0,
    "rejectionReason" TEXT,
    "supplierClaimRef" TEXT,
    "approvedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "handledBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_items" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "condition" TEXT,
    "restocked" BOOLEAN NOT NULL DEFAULT false,
    "refundCents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "return_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "return_requests_number_key" ON "return_requests"("number");

-- CreateIndex
CREATE INDEX "return_requests_orderId_idx" ON "return_requests"("orderId");

-- CreateIndex
CREATE INDEX "return_requests_status_createdAt_idx" ON "return_requests"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "return_items_returnId_orderItemId_key" ON "return_items"("returnId", "orderItemId");

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "return_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
