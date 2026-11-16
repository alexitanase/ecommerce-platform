-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "prevHash" TEXT,
ADD COLUMN     "rotatedAt" TIMESTAMP(3);
