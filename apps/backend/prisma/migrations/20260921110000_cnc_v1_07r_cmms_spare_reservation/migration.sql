-- CMMS spare reservations: hold stock for a maintenance work order without
-- moving physical on-hand, and make that hold visible to production allocation.
CREATE TYPE "MaintenanceSpareReservationStatus" AS ENUM ('OPEN', 'PARTIALLY_ISSUED', 'ISSUED', 'CANCELLED');

ALTER TABLE "MaintenanceSpareLine"
  ADD COLUMN "reservedQty" DECIMAL(18,6) NOT NULL DEFAULT 0;

CREATE TABLE "MaintenanceSpareReservation" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "spareLineId" TEXT NOT NULL,
  "binId" TEXT NOT NULL,
  "lotId" TEXT,
  "quantity" DECIMAL(18,6) NOT NULL,
  "issuedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "status" "MaintenanceSpareReservationStatus" NOT NULL DEFAULT 'OPEN',
  "idempotencyKey" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MaintenanceSpareReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MaintenanceSpareReservation_id_tenantId_key" ON "MaintenanceSpareReservation"("id", "tenantId");
CREATE UNIQUE INDEX "MaintenanceSpareReservation_tenantId_idempotencyKey_key" ON "MaintenanceSpareReservation"("tenantId", "idempotencyKey");
CREATE INDEX "MaintenanceSpareReservation_tenantId_spareLineId_status_idx" ON "MaintenanceSpareReservation"("tenantId", "spareLineId", "status");
CREATE INDEX "MaintenanceSpareReservation_tenantId_binId_lotId_status_idx" ON "MaintenanceSpareReservation"("tenantId", "binId", "lotId", "status");

ALTER TABLE "MaintenanceSpareReservation"
  ADD CONSTRAINT "MaintenanceSpareReservation_spareLineId_tenantId_fkey"
    FOREIGN KEY ("spareLineId", "tenantId") REFERENCES "MaintenanceSpareLine"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "MaintenanceSpareReservation_binId_fkey"
    FOREIGN KEY ("binId") REFERENCES "Bin"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "MaintenanceSpareReservation_lotId_fkey"
    FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "MaintenanceSpareReservation_createdById_tenantId_fkey"
    FOREIGN KEY ("createdById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
