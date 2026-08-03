-- MES-TOOL-001: keep the database race protection explicit and tenant scoped.
-- The physical ids are globally generated, but tenantId remains part of the
-- business key so the invariant does not rely on identifier implementation.
DROP INDEX IF EXISTS "OperationSetupAssignment_active_tool_reservation";
DROP INDEX IF EXISTS "OperationSetupAssignment_active_fixture_reservation";

CREATE UNIQUE INDEX "OperationSetupAssignment_active_tool_reservation"
  ON "OperationSetupAssignment" ("tenantId", "physicalToolInstanceId")
  WHERE "isActive" AND "physicalToolInstanceId" IS NOT NULL;

CREATE UNIQUE INDEX "OperationSetupAssignment_active_fixture_reservation"
  ON "OperationSetupAssignment" ("tenantId", "physicalFixtureInstanceId")
  WHERE "isActive" AND "physicalFixtureInstanceId" IS NOT NULL;
