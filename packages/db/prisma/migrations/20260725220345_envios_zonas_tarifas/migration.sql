-- CreateEnum
CREATE TYPE "ShippingRateType" AS ENUM ('FLAT', 'WEIGHT', 'ORDER_VALUE');

-- CreateTable
CREATE TABLE "shipping_zones" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countries" TEXT[],
    "postalPrefixes" TEXT[],
    "excludedPostalPrefixes" TEXT[],
    "outsideVatTerritory" BOOLEAN NOT NULL DEFAULT false,
    "customsWarning" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "shipping_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_rates" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "carrier" TEXT,
    "type" "ShippingRateType" NOT NULL DEFAULT 'FLAT',
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "freeFromCents" INTEGER,
    "minWeightGrams" INTEGER,
    "maxWeightGrams" INTEGER,
    "minOrderCents" INTEGER,
    "maxOrderCents" INTEGER,
    "minDays" INTEGER NOT NULL DEFAULT 3,
    "maxDays" INTEGER NOT NULL DEFAULT 10,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "shipping_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shipping_zones_isActive_priority_idx" ON "shipping_zones"("isActive", "priority");

-- CreateIndex
CREATE INDEX "shipping_rates_zoneId_isActive_position_idx" ON "shipping_rates"("zoneId", "isActive", "position");

-- AddForeignKey
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "shipping_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
