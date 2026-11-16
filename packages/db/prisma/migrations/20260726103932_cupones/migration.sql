-- CreateEnum
CREATE TYPE "CouponType" AS ENUM ('PERCENTAGE', 'FIXED', 'FREE_SHIPPING');

-- CreateTable
CREATE TABLE "coupons" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "CouponType" NOT NULL DEFAULT 'PERCENTAGE',
    "value" INTEGER NOT NULL DEFAULT 0,
    "maxDiscountCents" INTEGER,
    "minOrderCents" INTEGER NOT NULL DEFAULT 0,
    "maxUses" INTEGER,
    "maxUsesPerCustomer" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "categoryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludedProductIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "stackable" BOOLEAN NOT NULL DEFAULT false,
    "internalNote" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "discountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE INDEX "coupons_code_isActive_idx" ON "coupons"("code", "isActive");

-- CreateIndex
CREATE INDEX "coupons_validUntil_idx" ON "coupons"("validUntil");

-- CreateIndex
CREATE INDEX "coupon_redemptions_couponId_userId_idx" ON "coupon_redemptions"("couponId", "userId");

-- CreateIndex
CREATE INDEX "coupon_redemptions_couponId_email_idx" ON "coupon_redemptions"("couponId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_couponId_orderId_key" ON "coupon_redemptions"("couponId", "orderId");

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
