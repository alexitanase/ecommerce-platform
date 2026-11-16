-- CreateTable
CREATE TABLE "age_verifications" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "userId" TEXT,
    "birthYear" INTEGER NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'declaration',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipTruncated" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "age_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "age_verifications_visitorId_key" ON "age_verifications"("visitorId");

-- CreateIndex
CREATE INDEX "age_verifications_userId_idx" ON "age_verifications"("userId");

-- CreateIndex
CREATE INDEX "age_verifications_expiresAt_idx" ON "age_verifications"("expiresAt");
