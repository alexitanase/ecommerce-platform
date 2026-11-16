-- CreateTable
CREATE TABLE "consent_logs" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "userId" TEXT,
    "analytics" BOOLEAN NOT NULL DEFAULT false,
    "marketing" BOOLEAN NOT NULL DEFAULT false,
    "policyVersion" INTEGER NOT NULL DEFAULT 1,
    "ipTruncated" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consent_logs_visitorId_createdAt_idx" ON "consent_logs"("visitorId", "createdAt");

-- CreateIndex
CREATE INDEX "consent_logs_userId_idx" ON "consent_logs"("userId");

-- CreateIndex
CREATE INDEX "consent_logs_createdAt_idx" ON "consent_logs"("createdAt");
