-- AlterTable
ALTER TABLE "communication_preferences" ADD COLUMN     "newsletterConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "newsletterConfirmedIp" TEXT,
ADD COLUMN     "newsletterPendingAt" TIMESTAMP(3),
ADD COLUMN     "newsletterPendingToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "communication_preferences_newsletterPendingToken_key" ON "communication_preferences"("newsletterPendingToken");

