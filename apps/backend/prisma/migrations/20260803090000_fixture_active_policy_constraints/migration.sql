-- Exactly one currently active revision of each maintenance policy type may govern a fixture definition.
CREATE UNIQUE INDEX "FixtureMaintenancePolicy_active_type_unique"
  ON "FixtureMaintenancePolicy"("tenantId", "fixtureDefinitionId", "policyType")
  WHERE "isActive" = true;
-- Calibration has one policy scope per fixture definition.
CREATE UNIQUE INDEX "FixtureCalibrationPolicy_active_unique"
  ON "FixtureCalibrationPolicy"("tenantId", "fixtureDefinitionId")
  WHERE "isActive" = true;
