-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "coverAt" TIMESTAMP(3),
ADD COLUMN     "coverUrl" TEXT;

-- CreateIndex
CREATE INDEX "categories_coverAt_idx" ON "categories"("coverAt");
