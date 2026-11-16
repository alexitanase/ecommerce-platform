-- AlterTable
ALTER TABLE "users" ADD COLUMN     "referralCode" TEXT;

-- CreateTable
CREATE TABLE "referrals" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "referredEmail" TEXT NOT NULL,
    "referredUserId" TEXT,
    "orderId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "rejectionReason" TEXT,
    "referrerCouponId" TEXT,
    "referredCouponId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "referrals_orderId_key" ON "referrals"("orderId");

-- CreateIndex
CREATE INDEX "referrals_referrerId_status_idx" ON "referrals"("referrerId", "status");

-- CreateIndex
CREATE INDEX "referrals_referredEmail_idx" ON "referrals"("referredEmail");

-- CreateIndex
CREATE UNIQUE INDEX "users_referralCode_key" ON "users"("referralCode");

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

