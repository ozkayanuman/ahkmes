-- Manual bank reconciliation for AR/AP payments (ERP standalone-sellability
-- gap). No automatic statement import/matching — a privileged user marks a
-- payment reconciled against a bank reference.
ALTER TABLE "CustomerPayment"
  ADD COLUMN "isReconciled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reconciledAt" TIMESTAMP(3),
  ADD COLUMN "reconciledById" TEXT,
  ADD COLUMN "bankReference" TEXT;

ALTER TABLE "CustomerPayment"
  ADD CONSTRAINT "CustomerPayment_reconciledById_fkey" FOREIGN KEY ("reconciledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "CustomerPayment_tenantId_isReconciled_idx" ON "CustomerPayment"("tenantId", "isReconciled");

ALTER TABLE "SupplierPayment"
  ADD COLUMN "isReconciled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reconciledAt" TIMESTAMP(3),
  ADD COLUMN "reconciledById" TEXT,
  ADD COLUMN "bankReference" TEXT;

ALTER TABLE "SupplierPayment"
  ADD CONSTRAINT "SupplierPayment_reconciledById_fkey" FOREIGN KEY ("reconciledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "SupplierPayment_tenantId_isReconciled_idx" ON "SupplierPayment"("tenantId", "isReconciled");
