-- CreateTable
CREATE TABLE "price_history" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_history_variantId_validFrom_idx" ON "price_history"("variantId", "validFrom");

-- AddForeignKey
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
