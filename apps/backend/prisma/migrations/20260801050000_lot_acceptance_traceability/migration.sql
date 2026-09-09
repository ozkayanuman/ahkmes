-- AHK-005: opt-in lot/sertifika izlenebilirliği. Mevcut kalemler zorunlu
-- izlenebilirliğe alınmaz; üretim kesintisi olmadan açık politika seçilir.
CREATE TYPE "LotAcceptanceStatus" AS ENUM ('PENDING', 'ACCEPTED', 'QUARANTINED', 'REJECTED');

ALTER TABLE "Material"
  ADD COLUMN "lotTrackingRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "certificateRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Part" ADD COLUMN "lotTrackingRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Lot"
  ADD COLUMN "heatNumber" TEXT,
  ADD COLUMN "supplierLotNo" TEXT,
  ADD COLUMN "certificateNo" TEXT,
  ADD COLUMN "acceptanceStatus" "LotAcceptanceStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "acceptanceNote" TEXT,
  ADD COLUMN "acceptedById" TEXT,
  ADD COLUMN "acceptedAt" TIMESTAMP(3);
CREATE INDEX "Lot_tenantId_itemType_itemId_acceptanceStatus_idx" ON "Lot"("tenantId", "itemType", "itemId", "acceptanceStatus");
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
