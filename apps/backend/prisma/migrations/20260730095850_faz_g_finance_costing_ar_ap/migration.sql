-- AlterTable
ALTER TABLE "Machine" ADD COLUMN     "hourlyRate" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "Material" ADD COLUMN     "standardCost" DECIMAL(18,4);

-- AlterTable
ALTER TABLE "PurchaseOrderLine" ADD COLUMN     "invoicedQty" DECIMAL(18,3) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SupplierInvoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sinNo" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "issuedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoiceLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierInvoiceId" TEXT NOT NULL,
    "purchaseOrderLineId" TEXT NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "SupplierInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPayment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "spNo" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPaymentAllocation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierPaymentId" TEXT NOT NULL,
    "supplierInvoiceId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "SupplierPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPayment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cpNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPaymentAllocation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerPaymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "CustomerPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoice_sinNo_key" ON "SupplierInvoice"("sinNo");

-- CreateIndex
CREATE INDEX "SupplierInvoice_tenantId_purchaseOrderId_idx" ON "SupplierInvoice"("tenantId", "purchaseOrderId");

-- CreateIndex
CREATE INDEX "SupplierInvoice_tenantId_supplierId_idx" ON "SupplierInvoice"("tenantId", "supplierId");

-- CreateIndex
CREATE INDEX "SupplierInvoiceLine_tenantId_supplierInvoiceId_idx" ON "SupplierInvoiceLine"("tenantId", "supplierInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPayment_spNo_key" ON "SupplierPayment"("spNo");

-- CreateIndex
CREATE INDEX "SupplierPayment_tenantId_supplierId_idx" ON "SupplierPayment"("tenantId", "supplierId");

-- CreateIndex
CREATE INDEX "SupplierPaymentAllocation_tenantId_supplierInvoiceId_idx" ON "SupplierPaymentAllocation"("tenantId", "supplierInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPayment_cpNo_key" ON "CustomerPayment"("cpNo");

-- CreateIndex
CREATE INDEX "CustomerPayment_tenantId_customerId_idx" ON "CustomerPayment"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "CustomerPaymentAllocation_tenantId_invoiceId_idx" ON "CustomerPaymentAllocation"("tenantId", "invoiceId");

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPaymentAllocation" ADD CONSTRAINT "SupplierPaymentAllocation_supplierPaymentId_fkey" FOREIGN KEY ("supplierPaymentId") REFERENCES "SupplierPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPaymentAllocation" ADD CONSTRAINT "SupplierPaymentAllocation_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPayment" ADD CONSTRAINT "CustomerPayment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPayment" ADD CONSTRAINT "CustomerPayment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPaymentAllocation" ADD CONSTRAINT "CustomerPaymentAllocation_customerPaymentId_fkey" FOREIGN KEY ("customerPaymentId") REFERENCES "CustomerPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPaymentAllocation" ADD CONSTRAINT "CustomerPaymentAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
