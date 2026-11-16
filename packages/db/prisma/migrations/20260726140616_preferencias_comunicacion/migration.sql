-- CreateTable
CREATE TABLE "communication_preferences" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "unsubscribeToken" TEXT NOT NULL,
    "cartRecovery" BOOLEAN NOT NULL DEFAULT true,
    "reviewInvites" BOOLEAN NOT NULL DEFAULT true,
    "offers" BOOLEAN NOT NULL DEFAULT false,
    "newsletter" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "communication_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_consent_logs" (
    "id" TEXT NOT NULL,
    "preferenceId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "ipTruncated" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_consent_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "communication_preferences_email_key" ON "communication_preferences"("email");

-- CreateIndex
CREATE UNIQUE INDEX "communication_preferences_unsubscribeToken_key" ON "communication_preferences"("unsubscribeToken");

-- CreateIndex
CREATE INDEX "communication_preferences_userId_idx" ON "communication_preferences"("userId");

-- CreateIndex
CREATE INDEX "communication_consent_logs_preferenceId_createdAt_idx" ON "communication_consent_logs"("preferenceId", "createdAt");

-- AddForeignKey
ALTER TABLE "communication_consent_logs" ADD CONSTRAINT "communication_consent_logs_preferenceId_fkey" FOREIGN KEY ("preferenceId") REFERENCES "communication_preferences"("id") ON DELETE CASCADE ON UPDATE CASCADE;
