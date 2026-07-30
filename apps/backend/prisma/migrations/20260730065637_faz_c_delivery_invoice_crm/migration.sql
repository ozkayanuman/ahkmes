-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('ISSUED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dlvNo" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "shippedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "salesOrderLineId" TEXT NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "DeliveryLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invNo" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "issuedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "salesOrderLineId" TEXT NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerNote" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_dlvNo_key" ON "Delivery"("dlvNo");

-- CreateIndex
CREATE INDEX "Delivery_tenantId_salesOrderId_idx" ON "Delivery"("tenantId", "salesOrderId");

-- CreateIndex
CREATE INDEX "DeliveryLine_tenantId_deliveryId_idx" ON "DeliveryLine"("tenantId", "deliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invNo_key" ON "Invoice"("invNo");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_salesOrderId_idx" ON "Invoice"("tenantId", "salesOrderId");

-- CreateIndex
CREATE INDEX "InvoiceLine_tenantId_invoiceId_idx" ON "InvoiceLine"("tenantId", "invoiceId");

-- CreateIndex
CREATE INDEX "CustomerNote_tenantId_customerId_idx" ON "CustomerNote"("tenantId", "customerId");

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryLine" ADD CONSTRAINT "DeliveryLine_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryLine" ADD CONSTRAINT "DeliveryLine_salesOrderLineId_fkey" FOREIGN KEY ("salesOrderLineId") REFERENCES "SalesOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_salesOrderLineId_fkey" FOREIGN KEY ("salesOrderLineId") REFERENCES "SalesOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
