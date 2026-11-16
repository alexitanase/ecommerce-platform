-- CreateEnum
CREATE TYPE "PageStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "pages" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "status" "PageStatus" NOT NULL DEFAULT 'DRAFT',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_translations" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metaTitle" TEXT,
    "metaDescription" TEXT,

    CONSTRAINT "page_translations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pages_handle_key" ON "pages"("handle");

-- CreateIndex
CREATE INDEX "pages_status_idx" ON "pages"("status");

-- CreateIndex
CREATE UNIQUE INDEX "page_translations_pageId_locale_key" ON "page_translations"("pageId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "page_translations_locale_slug_key" ON "page_translations"("locale", "slug");

-- AddForeignKey
ALTER TABLE "page_translations" ADD CONSTRAINT "page_translations_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
