-- CreateTable
CREATE TABLE "post_categories" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "post_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_category_translations" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,

    CONSTRAINT "post_category_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "status" "PageStatus" NOT NULL DEFAULT 'DRAFT',
    "categoryId" TEXT,
    "coverUrl" TEXT,
    "publishedAt" TIMESTAMP(3),
    "updatedContentAt" TIMESTAMP(3),
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_translations" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "excerpt" TEXT,
    "content" TEXT NOT NULL,
    "metaTitle" TEXT,
    "metaDescription" TEXT,

    CONSTRAINT "post_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_products" (
    "postId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "post_products_pkey" PRIMARY KEY ("postId","productId")
);

-- CreateIndex
CREATE UNIQUE INDEX "post_categories_handle_key" ON "post_categories"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "post_category_translations_categoryId_locale_key" ON "post_category_translations"("categoryId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "post_category_translations_locale_slug_key" ON "post_category_translations"("locale", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "posts_handle_key" ON "posts"("handle");

-- CreateIndex
CREATE INDEX "posts_status_publishedAt_idx" ON "posts"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "posts_categoryId_idx" ON "posts"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "post_translations_postId_locale_key" ON "post_translations"("postId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "post_translations_locale_slug_key" ON "post_translations"("locale", "slug");

-- AddForeignKey
ALTER TABLE "post_category_translations" ADD CONSTRAINT "post_category_translations_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "post_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "post_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_translations" ADD CONSTRAINT "post_translations_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_products" ADD CONSTRAINT "post_products_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_products" ADD CONSTRAINT "post_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
