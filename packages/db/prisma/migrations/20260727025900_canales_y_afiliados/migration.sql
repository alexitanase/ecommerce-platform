-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "utmCampaign" TEXT,
ADD COLUMN     "utmMedium" TEXT,
ADD COLUMN     "utmSource" TEXT;

-- CreateTable
CREATE TABLE "affiliates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "commissionPercent" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "status" TEXT NOT NULL DEFAULT 'ACTIVO',
    "payoutNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "affiliates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_commissions" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "baseCents" INTEGER NOT NULL,
    "percent" DECIMAL(5,2) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliate_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "affiliates_email_key" ON "affiliates"("email");

-- CreateIndex
CREATE UNIQUE INDEX "affiliates_code_key" ON "affiliates"("code");

-- CreateIndex
CREATE INDEX "affiliates_status_idx" ON "affiliates"("status");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_commissions_orderId_key" ON "affiliate_commissions"("orderId");

-- CreateIndex
CREATE INDEX "affiliate_commissions_affiliateId_status_idx" ON "affiliate_commissions"("affiliateId", "status");

-- AddForeignKey
ALTER TABLE "affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

