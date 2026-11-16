-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "SupplierOrderStatus" AS ENUM ('PENDING', 'PLACING', 'PLACED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'FAILED');

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "credentials" TEXT,
    "credentialsSetAt" TIMESTAMP(3),
    "defaultMarginPct" DECIMAL(5,2) NOT NULL DEFAULT 60,
    "minMarginPct" DECIMAL(5,2) NOT NULL DEFAULT 25,
    "priceEnding" INTEGER NOT NULL DEFAULT 99,
    "includeShipping" BOOLEAN NOT NULL DEFAULT true,
    "syncIntervalMinutes" INTEGER NOT NULL DEFAULT 180,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT,
    "healthStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "healthCheckedAt" TIMESTAMP(3),
    "consecutiveErrors" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_products" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "externalProductId" TEXT NOT NULL,
    "externalVariantId" TEXT,
    "costCents" INTEGER NOT NULL,
    "shippingCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "stock" INTEGER NOT NULL DEFAULT 0,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "discontinued" BOOLEAN NOT NULL DEFAULT false,
    "discontinuedAt" TIMESTAMP(3),
    "leadTimeMinDays" INTEGER,
    "leadTimeMaxDays" INTEGER,
    "lastCheckedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_sync_runs" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "SyncRunStatus" NOT NULL DEFAULT 'RUNNING',
    "itemsChecked" INTEGER NOT NULL DEFAULT 0,
    "itemsUpdated" INTEGER NOT NULL DEFAULT 0,
    "priceChanges" INTEGER NOT NULL DEFAULT 0,
    "stockChanges" INTEGER NOT NULL DEFAULT 0,
    "itemsDiscontinued" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "errorDetail" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "supplier_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_orders" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "externalOrderId" TEXT,
    "status" "SupplierOrderStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "costTotalCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "shippingSnapshot" JSONB NOT NULL,
    "linesSnapshot" JSONB NOT NULL,
    "trackingCarrier" TEXT,
    "trackingNumber" TEXT,
    "trackingUrl" TEXT,
    "trackingStatus" TEXT,
    "trackingEvents" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastErrorType" TEXT,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "placedAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suppliers_isActive_priority_idx" ON "suppliers"("isActive", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_key_name_key" ON "suppliers"("key", "name");

-- CreateIndex
CREATE INDEX "supplier_products_productId_idx" ON "supplier_products"("productId");

-- CreateIndex
CREATE INDEX "supplier_products_variantId_idx" ON "supplier_products"("variantId");

-- CreateIndex
CREATE INDEX "supplier_products_supplierId_available_idx" ON "supplier_products"("supplierId", "available");

-- CreateIndex
CREATE INDEX "supplier_products_discontinued_idx" ON "supplier_products"("discontinued");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_products_supplierId_externalProductId_externalVari_key" ON "supplier_products"("supplierId", "externalProductId", "externalVariantId");

-- CreateIndex
CREATE INDEX "supplier_sync_runs_supplierId_startedAt_idx" ON "supplier_sync_runs"("supplierId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_orders_idempotencyKey_key" ON "supplier_orders"("idempotencyKey");

-- CreateIndex
CREATE INDEX "supplier_orders_orderId_idx" ON "supplier_orders"("orderId");

-- CreateIndex
CREATE INDEX "supplier_orders_status_needsReview_idx" ON "supplier_orders"("status", "needsReview");

-- CreateIndex
CREATE INDEX "supplier_orders_supplierId_status_idx" ON "supplier_orders"("supplierId", "status");

-- AddForeignKey
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_sync_runs" ADD CONSTRAINT "supplier_sync_runs_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
