-- CreateTable
CREATE TABLE "supplier_categories" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 1,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "categoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_categories_categoryId_idx" ON "supplier_categories"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_categories_supplierId_path_key" ON "supplier_categories"("supplierId", "path");

-- AddForeignKey
ALTER TABLE "supplier_categories" ADD CONSTRAINT "supplier_categories_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_categories" ADD CONSTRAINT "supplier_categories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
