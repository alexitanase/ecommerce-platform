-- CreateTable
CREATE TABLE "experiments" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hypothesis" TEXT,
    "status" TEXT NOT NULL DEFAULT 'BORRADOR',
    "variants" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "winner" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "experiments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiment_assignments" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "convertedAt" TIMESTAMP(3),
    "orderId" TEXT,
    "revenueCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiment_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "experiments_key_key" ON "experiments"("key");

-- CreateIndex
CREATE INDEX "experiments_status_idx" ON "experiments"("status");

-- CreateIndex
CREATE INDEX "experiment_assignments_experimentId_variant_idx" ON "experiment_assignments"("experimentId", "variant");

-- CreateIndex
CREATE UNIQUE INDEX "experiment_assignments_experimentId_visitorId_key" ON "experiment_assignments"("experimentId", "visitorId");

-- AddForeignKey
ALTER TABLE "experiment_assignments" ADD CONSTRAINT "experiment_assignments_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "experiments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

