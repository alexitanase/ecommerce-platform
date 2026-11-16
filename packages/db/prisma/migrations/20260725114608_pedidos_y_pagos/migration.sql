-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'AWAITING_PAYMENT', 'PAYMENT_CONFIRMING', 'PAID', 'PREPARING', 'SENT_TO_SUPPLIER', 'IN_TRANSIT', 'DELIVERED', 'PENDING_CLOSE', 'CLOSED', 'CANCELLED', 'REFUNDED', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'AWAITING_CONFIRMATION', 'PARTIALLY_PAID', 'PAID', 'OVERPAID', 'EXPIRED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED', 'FAILED');

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'es',
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "shippingCents" INTEGER NOT NULL DEFAULT 0,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "supplierCostCents" INTEGER NOT NULL DEFAULT 0,
    "gatewayFeeCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 21,
    "shippingAddress" JSONB NOT NULL,
    "billingAddress" JSONB,
    "customerNote" TEXT,
    "internalNote" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "variantName" TEXT,
    "imageUrl" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "unitCostCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 21,
    "refundedQuantity" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "actorType" TEXT NOT NULL DEFAULT 'system',
    "actorId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "receivedCents" INTEGER NOT NULL DEFAULT 0,
    "payCurrency" TEXT,
    "payAmount" TEXT,
    "payAddress" TEXT,
    "exchangeRate" TEXT,
    "rateLockedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "txHash" TEXT,
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "feeCents" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT,
    "failureReason" TEXT,
    "rawPayload" JSONB,
    "paidAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "payoutAddress" TEXT,
    "payoutCurrency" TEXT,
    "payoutNetwork" TEXT,
    "payoutTxHash" TEXT,
    "externalId" TEXT,
    "requestedBy" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_number_key" ON "orders"("number");

-- CreateIndex
CREATE INDEX "orders_userId_createdAt_idx" ON "orders"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "orders_status_createdAt_idx" ON "orders"("status", "createdAt");

-- CreateIndex
CREATE INDEX "orders_paymentStatus_idx" ON "orders"("paymentStatus");

-- CreateIndex
CREATE INDEX "orders_email_idx" ON "orders"("email");

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE INDEX "order_items_productId_idx" ON "order_items"("productId");

-- CreateIndex
CREATE INDEX "order_events_orderId_createdAt_idx" ON "order_events"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotencyKey_key" ON "payments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payments_orderId_idx" ON "payments"("orderId");

-- CreateIndex
CREATE INDEX "payments_provider_externalId_idx" ON "payments"("provider", "externalId");

-- CreateIndex
CREATE INDEX "payments_status_expiresAt_idx" ON "payments"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "refunds_status_idx" ON "refunds"("status");

-- CreateIndex
CREATE INDEX "refunds_paymentId_idx" ON "refunds"("paymentId");

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
