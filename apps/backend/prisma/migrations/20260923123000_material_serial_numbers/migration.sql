CREATE TYPE "MaterialSerialStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'ISSUED', 'CONSUMED', 'RETURNED', 'SCRAPPED');
CREATE TABLE "MaterialSerialNumber" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "serialNo" TEXT NOT NULL,
  "materialId" TEXT NOT NULL, "lotId" TEXT, "status" "MaterialSerialStatus" NOT NULL DEFAULT 'AVAILABLE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MaterialSerialNumber_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MaterialSerialNumber_tenantId_serialNo_key" UNIQUE ("tenantId", "serialNo"),
  CONSTRAINT "MaterialSerialNumber_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MaterialSerialNumber_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "MaterialSerialNumber_tenantId_materialId_status_idx" ON "MaterialSerialNumber"("tenantId", "materialId", "status");
CREATE INDEX "MaterialSerialNumber_tenantId_lotId_idx" ON "MaterialSerialNumber"("tenantId", "lotId");
