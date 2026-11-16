-- CreateTable
CREATE TABLE "integrations" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB,
    "credentials" TEXT,
    "credentialsSetAt" TIMESTAMP(3),
    "lastCheckAt" TIMESTAMP(3),
    "lastCheckOk" BOOLEAN,
    "lastCheckError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integrations_key_key" ON "integrations"("key");

-- CreateIndex
CREATE INDEX "integrations_kind_isActive_idx" ON "integrations"("kind", "isActive");
