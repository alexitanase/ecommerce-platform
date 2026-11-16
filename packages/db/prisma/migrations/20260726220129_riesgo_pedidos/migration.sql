-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "riskClearedAt" TIMESTAMP(3),
ADD COLUMN     "riskClearedBy" TEXT,
ADD COLUMN     "riskDecision" TEXT NOT NULL DEFAULT 'ACEPTAR',
ADD COLUMN     "riskReasons" JSONB,
ADD COLUMN     "riskScore" INTEGER NOT NULL DEFAULT 0;
