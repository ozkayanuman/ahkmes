-- Runtime PM is a first-class maintenance-order provenance, not an inferred
-- description string. The nullable unique key permits calendar/manual work
-- orders while ensuring one generated PM work order per machine threshold.
ALTER TABLE "MaintenanceOrder"
  ADD COLUMN "runtimeTriggerHours" DECIMAL(18,2);

CREATE UNIQUE INDEX "MaintenanceOrder_tenantId_machineId_runtimeTriggerHours_key"
  ON "MaintenanceOrder"("tenantId", "machineId", "runtimeTriggerHours");
