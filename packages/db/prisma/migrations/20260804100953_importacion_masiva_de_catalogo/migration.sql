-- CreateEnum
CREATE TYPE "BulkImportStatus" AS ENUM ('RUNNING', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateTable
CREATE TABLE "supplier_bulk_imports" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "BulkImportStatus" NOT NULL DEFAULT 'RUNNING',
    "total" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "imagesImported" INTEGER NOT NULL DEFAULT 0,
    "pricedFromRrp" INTEGER NOT NULL DEFAULT 0,
    "pricedAtMin" INTEGER NOT NULL DEFAULT 0,
    "pricedByMargin" INTEGER NOT NULL DEFAULT 0,
    "currentLabel" TEXT,
    "failures" JSONB,
    "errorDetail" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "startedBy" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "supplier_bulk_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_bulk_imports_supplierId_startedAt_idx" ON "supplier_bulk_imports"("supplierId", "startedAt");

-- AddForeignKey
ALTER TABLE "supplier_bulk_imports" ADD CONSTRAINT "supplier_bulk_imports_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
