-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('INVOICE', 'CREDIT_NOTE');

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "type" "InvoiceType" NOT NULL DEFAULT 'INVOICE',
    "series" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "fullNumber" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "correctsInvoiceId" TEXT,
    "issuerSnapshot" JSONB NOT NULL,
    "customerSnapshot" JSONB NOT NULL,
    "linesSnapshot" JSONB NOT NULL,
    "subtotalCents" INTEGER NOT NULL,
    "taxCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "cryptoAmount" TEXT,
    "cryptoCurrency" TEXT,
    "exchangeRate" TEXT,
    "pdfKey" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_counters" (
    "id" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_fullNumber_key" ON "invoices"("fullNumber");

-- CreateIndex
CREATE INDEX "invoices_orderId_idx" ON "invoices"("orderId");

-- CreateIndex
CREATE INDEX "invoices_issuedAt_idx" ON "invoices"("issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_series_number_type_key" ON "invoices"("series", "number", "type");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_counters_series_year_key" ON "invoice_counters"("series", "year");
