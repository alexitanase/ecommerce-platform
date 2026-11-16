-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('BORRADOR', 'ACTIVA', 'PAUSADA', 'ARCHIVADA');

-- CreateEnum
CREATE TYPE "CreativeStatus" AS ENUM ('BORRADOR', 'EN_REVISION', 'APROBADA', 'PUBLICADA', 'ARCHIVADA');

-- CreateEnum
CREATE TYPE "RenderStatus" AS ENUM ('PENDIENTE', 'PROCESANDO', 'LISTO', 'FALLIDO');

-- CreateEnum
CREATE TYPE "StudioAssetKind" AS ENUM ('IMAGEN', 'VIDEO', 'AUDIO', 'VECTOR');

-- CreateEnum
CREATE TYPE "StudioAssetSource" AS ENUM ('SUBIDA', 'IA', 'CATALOGO', 'PROVEEDOR');

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "objective" TEXT NOT NULL DEFAULT 'venta',
    "channel" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'BORRADOR',
    "brief" TEXT,
    "audience" TEXT,
    "locales" TEXT[] DEFAULT ARRAY['es']::TEXT[],
    "landingUrl" TEXT,
    "budgetCents" INTEGER,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creatives" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'banner',
    "format" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'es',
    "status" "CreativeStatus" NOT NULL DEFAULT 'BORRADOR',
    "variantOfId" TEXT,
    "utmContent" TEXT NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 0,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "creatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creative_versions" (
    "id" TEXT NOT NULL,
    "creativeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "document" JSONB NOT NULL,
    "label" TEXT,
    "authorId" TEXT,
    "authorModel" TEXT,
    "prompt" TEXT,
    "parentVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creative_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creative_renders" (
    "id" TEXT NOT NULL,
    "creativeId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'es',
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sizeBytes" INTEGER,
    "status" "RenderStatus" NOT NULL DEFAULT 'PENDIENTE',
    "storageKey" TEXT,
    "url" TEXT,
    "checksum" TEXT,
    "validation" JSONB,
    "error" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "creative_renders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_assets" (
    "id" TEXT NOT NULL,
    "kind" "StudioAssetKind" NOT NULL DEFAULT 'IMAGEN',
    "name" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "sizeBytes" INTEGER,
    "blurhash" TEXT,
    "source" "StudioAssetSource" NOT NULL DEFAULT 'SUBIDA',
    "derivedFromId" TEXT,
    "productId" TEXT,
    "model" TEXT,
    "prompt" TEXT,
    "seed" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "studio_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "family" TEXT NOT NULL DEFAULT 'display',
    "document" JSONB NOT NULL,
    "previewUrl" TEXT,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "studio_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_components" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "layers" JSONB NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "previewUrl" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "studio_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_generations" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "campaignId" TEXT,
    "creativeId" TEXT,
    "prompt" TEXT,
    "parameters" JSONB,
    "inputAssetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "outputAssetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "inputHash" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "gpuSeconds" INTEGER,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_generations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_spends" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "automatic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_spends_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_slug_key" ON "campaigns"("slug");

-- CreateIndex
CREATE INDEX "campaigns_status_startsAt_idx" ON "campaigns"("status", "startsAt");

-- CreateIndex
CREATE INDEX "campaigns_channel_idx" ON "campaigns"("channel");

-- CreateIndex
CREATE UNIQUE INDEX "creatives_utmContent_key" ON "creatives"("utmContent");

-- CreateIndex
CREATE INDEX "creatives_campaignId_status_idx" ON "creatives"("campaignId", "status");

-- CreateIndex
CREATE INDEX "creatives_format_idx" ON "creatives"("format");

-- CreateIndex
CREATE INDEX "creative_versions_creativeId_createdAt_idx" ON "creative_versions"("creativeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "creative_versions_creativeId_version_key" ON "creative_versions"("creativeId", "version");

-- CreateIndex
CREATE INDEX "creative_renders_creativeId_format_idx" ON "creative_renders"("creativeId", "format");

-- CreateIndex
CREATE INDEX "creative_renders_status_createdAt_idx" ON "creative_renders"("status", "createdAt");

-- CreateIndex
CREATE INDEX "creative_renders_expiresAt_idx" ON "creative_renders"("expiresAt");

-- CreateIndex
CREATE INDEX "studio_assets_kind_createdAt_idx" ON "studio_assets"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "studio_assets_source_idx" ON "studio_assets"("source");

-- CreateIndex
CREATE INDEX "studio_assets_productId_idx" ON "studio_assets"("productId");

-- CreateIndex
CREATE INDEX "studio_templates_family_idx" ON "studio_templates"("family");

-- CreateIndex
CREATE INDEX "ai_generations_campaignId_createdAt_idx" ON "ai_generations"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_generations_provider_createdAt_idx" ON "ai_generations"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "ai_generations_inputHash_idx" ON "ai_generations"("inputHash");

-- CreateIndex
CREATE INDEX "campaign_spends_day_idx" ON "campaign_spends"("day");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_spends_campaignId_network_day_key" ON "campaign_spends"("campaignId", "network", "day");

-- AddForeignKey
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_variantOfId_fkey" FOREIGN KEY ("variantOfId") REFERENCES "creatives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_versions" ADD CONSTRAINT "creative_versions_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "creatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_renders" ADD CONSTRAINT "creative_renders_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "creatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_assets" ADD CONSTRAINT "studio_assets_derivedFromId_fkey" FOREIGN KEY ("derivedFromId") REFERENCES "studio_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "creatives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_spends" ADD CONSTRAINT "campaign_spends_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
