-- First supplier return-to-vendor evidence slice. Rejected lots never enter
-- inventory, so this table intentionally does not create an inventory movement.
CREATE TABLE "SupplierLotReturn" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "lotId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "quantity" DECIMAL(18,3) NOT NULL,
  "shipmentReference" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "returnedById" TEXT NOT NULL,
  "returnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SupplierLotReturn_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierLotReturn_lotId_key" UNIQUE ("lotId"),
  CONSTRAINT "SupplierLotReturn_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SupplierLotReturn_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SupplierLotReturn_returnedById_fkey" FOREIGN KEY ("returnedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "SupplierLotReturn_tenantId_supplierId_returnedAt_idx"
  ON "SupplierLotReturn"("tenantId", "supplierId", "returnedAt");
