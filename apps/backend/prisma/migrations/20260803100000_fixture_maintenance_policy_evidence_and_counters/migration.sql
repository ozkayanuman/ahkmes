-- MES-FIXTURE-MAINT-001: policy evidence stays explicit. Existing fixtures
-- and historic generic maintenance events are deliberately not backfilled as
-- compliant evidence.
ALTER TABLE "PhysicalFixtureInstance"
  ADD COLUMN "maintenanceCycleCount" DECIMAL(18,3) NOT NULL DEFAULT 0,
  ADD COLUMN "maintenancePartCount" DECIMAL(18,3) NOT NULL DEFAULT 0;

ALTER TABLE "FixtureMaintenanceEvent"
  ADD COLUMN "fixtureMaintenancePolicyId" TEXT,
  ADD COLUMN "completionIdempotencyKey" TEXT;

ALTER TABLE "FixtureMaintenanceEvent"
  ADD CONSTRAINT "FixtureMaintenanceEvent_fixtureMaintenancePolicyId_fkey"
  FOREIGN KEY ("fixtureMaintenancePolicyId") REFERENCES "FixtureMaintenancePolicy"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "FixtureMaintenanceEvent_tenant_policy_completed_idx"
  ON "FixtureMaintenanceEvent"("tenantId", "fixtureMaintenancePolicyId", "completedAt");

-- A repeated completion message must resolve to the same event, never a
-- second maintenance completion side effect.
CREATE UNIQUE INDEX "FixtureMaintenanceEvent_tenant_completion_idempotency_unique"
  ON "FixtureMaintenanceEvent"("tenantId", "completionIdempotencyKey")
  WHERE "completionIdempotencyKey" IS NOT NULL;
