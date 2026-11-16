-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "StockMovementReason" AS ENUM ('PURCHASE', 'RETURN', 'SUPPLIER_SYNC', 'MANUAL', 'CANCELLATION');

-- CreateEnum
CREATE TYPE "CollectionType" AS ENUM ('MANUAL', 'AUTOMATIC');

-- CreateEnum
CREATE TYPE "AttributeType" AS ENUM ('TEXT', 'NUMBER', 'BOOLEAN', 'SELECT', 'MULTISELECT');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('IMAGE', 'VIDEO');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "handle" TEXT NOT NULL,
    "categoryId" TEXT,
    "brandId" TEXT,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 21,
    "isAdult" BOOLEAN NOT NULL DEFAULT false,
    "requiresShipping" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_translations" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "shortDescription" TEXT,
    "description" TEXT,
    "metaTitle" TEXT,
    "metaDescription" TEXT,

    CONSTRAINT "product_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_options" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_option_translations" (
    "id" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "product_option_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_option_values" (
    "id" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "labels" JSONB,
    "hexColor" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_option_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "priceCents" INTEGER NOT NULL,
    "compareAtCents" INTEGER,
    "costCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "weightGrams" INTEGER,
    "lengthMm" INTEGER,
    "widthMm" INTEGER,
    "heightMm" INTEGER,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "lowStockAlert" INTEGER NOT NULL DEFAULT 5,
    "allowBackorder" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variant_option_values" (
    "variantId" TEXT NOT NULL,
    "optionValueId" TEXT NOT NULL,

    CONSTRAINT "variant_option_values_pkey" PRIMARY KEY ("variantId","optionValueId")
);

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "cartId" TEXT,
    "orderId" TEXT,
    "quantity" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "stockAfter" INTEGER NOT NULL,
    "reason" "StockMovementReason" NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "handle" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "imageUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isAdult" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_translations" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "metaTitle" TEXT,
    "metaDescription" TEXT,

    CONSTRAINT "category_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collections" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "type" "CollectionType" NOT NULL DEFAULT 'MANUAL',
    "rules" JSONB,
    "imageUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_translations" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "metaTitle" TEXT,
    "metaDescription" TEXT,

    CONSTRAINT "collection_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_products" (
    "collectionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "collection_products_pkey" PRIMARY KEY ("collectionId","productId")
);

-- CreateTable
CREATE TABLE "attributes" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" "AttributeType" NOT NULL DEFAULT 'TEXT',
    "unit" TEXT,
    "isFilterable" BOOLEAN NOT NULL DEFAULT true,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "options" JSONB,
    "labels" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_attributes" (
    "categoryId" TEXT NOT NULL,
    "attributeId" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "category_attributes_pkey" PRIMARY KEY ("categoryId","attributeId")
);

-- CreateTable
CREATE TABLE "product_attributes" (
    "productId" TEXT NOT NULL,
    "attributeId" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "product_attributes_pkey" PRIMARY KEY ("productId","attributeId")
);

-- CreateTable
CREATE TABLE "media" (
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "kind" "MediaKind" NOT NULL DEFAULT 'IMAGE',
    "storageKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "sizeBytes" INTEGER,
    "blurhash" TEXT,
    "alt" JSONB,
    "position" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'upload',
    "originalMediaId" TEXT,
    "aiProcessed" BOOLEAN NOT NULL DEFAULT false,
    "aiApprovedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "userId" TEXT,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "isVerifiedPurchase" BOOLEAN NOT NULL DEFAULT false,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "locale" TEXT NOT NULL DEFAULT 'es',
    "reply" TEXT,
    "repliedAt" TIMESTAMP(3),
    "helpfulCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_handle_key" ON "products"("handle");

-- CreateIndex
CREATE INDEX "products_status_publishedAt_idx" ON "products"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "products_categoryId_status_idx" ON "products"("categoryId", "status");

-- CreateIndex
CREATE INDEX "products_deletedAt_idx" ON "products"("deletedAt");

-- CreateIndex
CREATE INDEX "product_translations_locale_idx" ON "product_translations"("locale");

-- CreateIndex
CREATE UNIQUE INDEX "product_translations_productId_locale_key" ON "product_translations"("productId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "product_translations_locale_slug_key" ON "product_translations"("locale", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "product_options_productId_key_key" ON "product_options"("productId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "product_option_translations_optionId_locale_key" ON "product_option_translations"("optionId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "product_option_values_optionId_value_key" ON "product_option_values"("optionId", "value");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_sku_key" ON "product_variants"("sku");

-- CreateIndex
CREATE INDEX "product_variants_productId_isActive_idx" ON "product_variants"("productId", "isActive");

-- CreateIndex
CREATE INDEX "product_variants_stock_idx" ON "product_variants"("stock");

-- CreateIndex
CREATE INDEX "stock_reservations_variantId_idx" ON "stock_reservations"("variantId");

-- CreateIndex
CREATE INDEX "stock_reservations_expiresAt_idx" ON "stock_reservations"("expiresAt");

-- CreateIndex
CREATE INDEX "stock_reservations_cartId_idx" ON "stock_reservations"("cartId");

-- CreateIndex
CREATE INDEX "stock_movements_variantId_createdAt_idx" ON "stock_movements"("variantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "categories_handle_key" ON "categories"("handle");

-- CreateIndex
CREATE INDEX "categories_parentId_position_idx" ON "categories"("parentId", "position");

-- CreateIndex
CREATE INDEX "categories_path_idx" ON "categories"("path");

-- CreateIndex
CREATE UNIQUE INDEX "category_translations_categoryId_locale_key" ON "category_translations"("categoryId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "category_translations_locale_slug_key" ON "category_translations"("locale", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "brands_handle_key" ON "brands"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "collections_handle_key" ON "collections"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "collection_translations_collectionId_locale_key" ON "collection_translations"("collectionId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "collection_translations_locale_slug_key" ON "collection_translations"("locale", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "attributes_key_key" ON "attributes"("key");

-- CreateIndex
CREATE INDEX "product_attributes_attributeId_idx" ON "product_attributes"("attributeId");

-- CreateIndex
CREATE INDEX "media_productId_position_idx" ON "media"("productId", "position");

-- CreateIndex
CREATE INDEX "media_variantId_idx" ON "media"("variantId");

-- CreateIndex
CREATE INDEX "reviews_productId_status_idx" ON "reviews"("productId", "status");

-- CreateIndex
CREATE INDEX "reviews_userId_idx" ON "reviews"("userId");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_translations" ADD CONSTRAINT "product_translations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_options" ADD CONSTRAINT "product_options_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_translations" ADD CONSTRAINT "product_option_translations_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "product_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "product_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_option_values" ADD CONSTRAINT "variant_option_values_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_option_values" ADD CONSTRAINT "variant_option_values_optionValueId_fkey" FOREIGN KEY ("optionValueId") REFERENCES "product_option_values"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_translations" ADD CONSTRAINT "category_translations_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_translations" ADD CONSTRAINT "collection_translations_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_products" ADD CONSTRAINT "collection_products_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_products" ADD CONSTRAINT "collection_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_attributes" ADD CONSTRAINT "category_attributes_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_attributes" ADD CONSTRAINT "category_attributes_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "attributes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "attributes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
