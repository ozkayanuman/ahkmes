ALTER TABLE "MaterialSerialNumber" ADD COLUMN "reservationId" TEXT;
ALTER TABLE "MaterialSerialNumber" ADD CONSTRAINT "MaterialSerialNumber_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "ProductionMaterialReservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "MaterialSerialNumber_tenantId_reservationId_idx" ON "MaterialSerialNumber"("tenantId", "reservationId");
