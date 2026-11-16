-- CreateTable
CREATE TABLE "product_translation_drafts" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "shortDescription" TEXT,
    "description" TEXT,
    "engine" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_translation_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_translation_drafts_createdAt_idx" ON "product_translation_drafts"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "product_translation_drafts_productId_locale_key" ON "product_translation_drafts"("productId", "locale");

-- AddForeignKey
ALTER TABLE "product_translation_drafts" ADD CONSTRAINT "product_translation_drafts_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
