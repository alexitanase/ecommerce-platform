-- CreateTable
CREATE TABLE "crypto_settlements" (
    "id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "proceedsCents" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL DEFAULT 0,
    "venue" TEXT,
    "reference" TEXT,
    "txHash" TEXT,
    "settledAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "crypto_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crypto_settlements_currency_settledAt_idx" ON "crypto_settlements"("currency", "settledAt");
