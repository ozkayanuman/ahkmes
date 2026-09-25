-- Explicit material<->supplier sourcing relationship (MRP standalone-
-- sellability gap): MRP previously had no way to know which supplier
-- normally sources a shortfall material.
CREATE TABLE "SupplierMaterial" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "materialId" TEXT NOT NULL,
  "isPreferred" BOOLEAN NOT NULL DEFAULT false,
  "leadTimeDays" INTEGER,
  "unitCost" DECIMAL(18,4),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SupplierMaterial_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierMaterial_tenantId_supplierId_materialId_key" UNIQUE ("tenantId", "supplierId", "materialId"),
  CONSTRAINT "SupplierMaterial_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SupplierMaterial_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "SupplierMaterial_tenantId_materialId_isPreferred_idx" ON "SupplierMaterial"("tenantId", "materialId", "isPreferred");

-- The service clears the old preference first; this is the concurrency-safe
-- authority that prevents two preferred suppliers for one material.
CREATE UNIQUE INDEX "SupplierMaterial_one_preferred_per_material_key"
  ON "SupplierMaterial"("tenantId", "materialId")
  WHERE "isPreferred" = true;
