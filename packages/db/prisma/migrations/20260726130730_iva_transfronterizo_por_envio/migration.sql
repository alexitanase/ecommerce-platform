-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "taxCountry" TEXT NOT NULL DEFAULT 'ES',
ADD COLUMN     "taxNeedsReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "taxNotices" JSONB,
ADD COLUMN     "taxRegime" TEXT NOT NULL DEFAULT 'INTERIOR';

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "shipsFromCountry" TEXT NOT NULL DEFAULT 'ES';

-- CreateIndex
CREATE INDEX "orders_taxRegime_createdAt_idx" ON "orders"("taxRegime", "createdAt");
