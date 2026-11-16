-- CreateEnum
CREATE TYPE "CatalogImportStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "freeShippingThresholdCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "orderShippingCents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "supplier_catalog_items" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "groupId" TEXT,
    "groupKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "groupTitle" TEXT,
    "shortDescription" TEXT,
    "descriptionHtml" TEXT,
    "brand" TEXT,
    "costCents" INTEGER NOT NULL,
    "rrpCents" INTEGER NOT NULL DEFAULT 0,
    "vatPct" DECIMAL(5,2) NOT NULL DEFAULT 21,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "stock" INTEGER NOT NULL DEFAULT 0,
    "available" BOOLEAN NOT NULL DEFAULT false,
    "imageUrls" JSONB NOT NULL,
    "categoryPath" JSONB NOT NULL,
    "categoryName" TEXT,
    "eans" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "weightGrams" INTEGER,
    "options" JSONB NOT NULL,
    "minUnits" INTEGER NOT NULL DEFAULT 1,
    "maxUnits" INTEGER NOT NULL DEFAULT 1,
    "leadTimeMinDays" INTEGER,
    "leadTimeMaxDays" INTEGER,
    "supplierUrl" TEXT,
    "onSale" BOOLEAN NOT NULL DEFAULT false,
    "isNew" BOOLEAN NOT NULL DEFAULT false,
    "clearance" BOOLEAN NOT NULL DEFAULT false,
    "searchText" TEXT NOT NULL,
    "supplierUpdatedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_catalog_imports" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "CatalogImportStatus" NOT NULL DEFAULT 'RUNNING',
    "fileName" TEXT NOT NULL,
    "fileSizeBytes" BIGINT NOT NULL DEFAULT 0,
    "itemsRead" INTEGER NOT NULL DEFAULT 0,
    "itemsCreated" INTEGER NOT NULL DEFAULT 0,
    "itemsUpdated" INTEGER NOT NULL DEFAULT 0,
    "itemsRemoved" INTEGER NOT NULL DEFAULT 0,
    "itemsDiscarded" INTEGER NOT NULL DEFAULT 0,
    "xmlErrors" INTEGER NOT NULL DEFAULT 0,
    "priceChanges" INTEGER NOT NULL DEFAULT 0,
    "stockChanges" INTEGER NOT NULL DEFAULT 0,
    "linkedRefreshed" INTEGER NOT NULL DEFAULT 0,
    "errorDetail" TEXT,
    "uploadedBy" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "supplier_catalog_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_catalog_items_supplierId_code_idx" ON "supplier_catalog_items"("supplierId", "code");

-- CreateIndex
CREATE INDEX "supplier_catalog_items_supplierId_groupKey_idx" ON "supplier_catalog_items"("supplierId", "groupKey");

-- CreateIndex
CREATE INDEX "supplier_catalog_items_supplierId_removed_available_idx" ON "supplier_catalog_items"("supplierId", "removed", "available");

-- CreateIndex
CREATE INDEX "supplier_catalog_items_supplierId_searchText_idx" ON "supplier_catalog_items"("supplierId", "searchText");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_catalog_items_supplierId_externalId_key" ON "supplier_catalog_items"("supplierId", "externalId");

-- CreateIndex
CREATE INDEX "supplier_catalog_imports_supplierId_startedAt_idx" ON "supplier_catalog_imports"("supplierId", "startedAt");

-- AddForeignKey
ALTER TABLE "supplier_catalog_items" ADD CONSTRAINT "supplier_catalog_items_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_catalog_imports" ADD CONSTRAINT "supplier_catalog_imports_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
