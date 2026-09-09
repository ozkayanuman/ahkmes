-- MES-TOOL-001: forward-only CNC tooling, fixture and verified-setup domain.
-- No legacy work-order operation is backfilled as verified or compatible.
ALTER TYPE "ProductModule" ADD VALUE IF NOT EXISTS 'MES_CNC_TOOLING';
CREATE TYPE "ToolLifePolicy" AS ENUM ('TIME', 'CYCLE', 'PART_COUNT');
CREATE TYPE "PhysicalToolStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'IN_USE', 'EXPIRED', 'BROKEN', 'QUARANTINED', 'RETIRED');
CREATE TYPE "PhysicalFixtureStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'IN_USE', 'MAINTENANCE', 'QUARANTINED', 'RETIRED');
CREATE TYPE "SetupVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'INVALIDATED', 'RELEASED');

CREATE TABLE "ToolDefinition" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL,
  "toolType" TEXT NOT NULL, "manufacturerCode" TEXT, "lifePolicy" "ToolLifePolicy" NOT NULL,
  "maximumLife" DECIMAL(18,3) NOT NULL, "warningThreshold" DECIMAL(18,3) NOT NULL,
  "lifeUnit" TEXT NOT NULL, "revision" TEXT NOT NULL DEFAULT 'A', "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ToolDefinition_life_nonnegative" CHECK ("maximumLife" > 0 AND "warningThreshold" >= 0 AND "warningThreshold" <= "maximumLife")
);
CREATE TABLE "ToolComponent" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "componentType" TEXT NOT NULL, "code" TEXT NOT NULL,
  "name" TEXT NOT NULL, "manufacturerCode" TEXT, "revision" TEXT NOT NULL DEFAULT 'A', "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "ToolAssembly" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "toolDefinitionId" TEXT NOT NULL, "code" TEXT NOT NULL,
  "name" TEXT NOT NULL, "revision" TEXT NOT NULL DEFAULT 'A', "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  FOREIGN KEY ("toolDefinitionId") REFERENCES "ToolDefinition"("id") ON DELETE RESTRICT
);
CREATE TABLE "ToolAssemblyComponent" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "toolAssemblyId" TEXT NOT NULL, "toolComponentId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1, "sequence" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ToolAssemblyComponent_quantity_positive" CHECK ("quantity" > 0),
  FOREIGN KEY ("toolAssemblyId") REFERENCES "ToolAssembly"("id") ON DELETE CASCADE,
  FOREIGN KEY ("toolComponentId") REFERENCES "ToolComponent"("id") ON DELETE RESTRICT
);
CREATE TABLE "PhysicalToolInstance" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "toolDefinitionId" TEXT NOT NULL, "toolAssemblyId" TEXT,
  "serialNo" TEXT NOT NULL, "barcode" TEXT, "location" TEXT, "consumedLife" DECIMAL(18,3) NOT NULL DEFAULT 0,
  "remainingLife" DECIMAL(18,3) NOT NULL, "status" "PhysicalToolStatus" NOT NULL DEFAULT 'AVAILABLE',
  "version" INTEGER NOT NULL DEFAULT 1, "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PhysicalToolInstance_life_nonnegative" CHECK ("consumedLife" >= 0 AND "remainingLife" >= 0 AND "version" > 0),
  FOREIGN KEY ("toolDefinitionId") REFERENCES "ToolDefinition"("id") ON DELETE RESTRICT,
  FOREIGN KEY ("toolAssemblyId") REFERENCES "ToolAssembly"("id") ON DELETE RESTRICT
);
CREATE TABLE "FixtureDefinition" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL,
  "fixtureType" TEXT NOT NULL, "revision" TEXT NOT NULL DEFAULT 'A', "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "PhysicalFixtureInstance" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "fixtureDefinitionId" TEXT NOT NULL, "serialNo" TEXT NOT NULL,
  "barcode" TEXT, "location" TEXT, "status" "PhysicalFixtureStatus" NOT NULL DEFAULT 'AVAILABLE', "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PhysicalFixtureInstance_version_positive" CHECK ("version" > 0),
  FOREIGN KEY ("fixtureDefinitionId") REFERENCES "FixtureDefinition"("id") ON DELETE RESTRICT
);
CREATE TABLE "ToolMachineCompatibility" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "machineId" TEXT NOT NULL, "toolDefinitionId" TEXT, "toolAssemblyId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ToolMachineCompatibility_exactly_one_subject" CHECK (("toolDefinitionId" IS NOT NULL) <> ("toolAssemblyId" IS NOT NULL)),
  FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE,
  FOREIGN KEY ("toolDefinitionId") REFERENCES "ToolDefinition"("id") ON DELETE CASCADE,
  FOREIGN KEY ("toolAssemblyId") REFERENCES "ToolAssembly"("id") ON DELETE CASCADE
);
CREATE TABLE "FixtureMachineCompatibility" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "machineId" TEXT NOT NULL, "fixtureDefinitionId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE,
  FOREIGN KEY ("fixtureDefinitionId") REFERENCES "FixtureDefinition"("id") ON DELETE CASCADE
);
CREATE TABLE "OperationToolRequirement" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "recipeStepId" TEXT, "workOrderOperationId" TEXT,
  "toolDefinitionId" TEXT, "toolAssemblyId" TEXT, "isRequired" BOOLEAN NOT NULL DEFAULT true, "quantity" INTEGER NOT NULL DEFAULT 1,
  "alternativeGroup" TEXT, "sequence" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperationToolRequirement_one_owner" CHECK (("recipeStepId" IS NOT NULL) <> ("workOrderOperationId" IS NOT NULL)),
  CONSTRAINT "OperationToolRequirement_one_subject" CHECK (("toolDefinitionId" IS NOT NULL) <> ("toolAssemblyId" IS NOT NULL)),
  CONSTRAINT "OperationToolRequirement_quantity_positive" CHECK ("quantity" > 0),
  FOREIGN KEY ("recipeStepId") REFERENCES "RecipeStep"("id") ON DELETE CASCADE,
  FOREIGN KEY ("workOrderOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE CASCADE,
  FOREIGN KEY ("toolDefinitionId") REFERENCES "ToolDefinition"("id") ON DELETE RESTRICT,
  FOREIGN KEY ("toolAssemblyId") REFERENCES "ToolAssembly"("id") ON DELETE RESTRICT
);
CREATE TABLE "OperationFixtureRequirement" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "recipeStepId" TEXT, "workOrderOperationId" TEXT,
  "fixtureDefinitionId" TEXT NOT NULL, "isRequired" BOOLEAN NOT NULL DEFAULT true, "quantity" INTEGER NOT NULL DEFAULT 1,
  "alternativeGroup" TEXT, "sequence" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperationFixtureRequirement_one_owner" CHECK (("recipeStepId" IS NOT NULL) <> ("workOrderOperationId" IS NOT NULL)),
  CONSTRAINT "OperationFixtureRequirement_quantity_positive" CHECK ("quantity" > 0),
  FOREIGN KEY ("recipeStepId") REFERENCES "RecipeStep"("id") ON DELETE CASCADE,
  FOREIGN KEY ("workOrderOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE CASCADE,
  FOREIGN KEY ("fixtureDefinitionId") REFERENCES "FixtureDefinition"("id") ON DELETE RESTRICT
);
CREATE TABLE "OperationSetupVerification" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "workOrderOperationId" TEXT NOT NULL, "machineId" TEXT NOT NULL,
  "status" "SetupVerificationStatus" NOT NULL DEFAULT 'PENDING', "verifiedById" TEXT, "verifiedAt" TIMESTAMP(3),
  "invalidatedAt" TIMESTAMP(3), "invalidatedReason" TEXT, "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperationSetupVerification_version_positive" CHECK ("version" > 0),
  FOREIGN KEY ("workOrderOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE CASCADE,
  FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE RESTRICT,
  FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE RESTRICT
);
CREATE TABLE "OperationSetupAssignment" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "verificationId" TEXT NOT NULL, "toolRequirementId" TEXT,
  "fixtureRequirementId" TEXT, "physicalToolInstanceId" TEXT, "physicalFixtureInstanceId" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "releasedAt" TIMESTAMP(3),
  CONSTRAINT "OperationSetupAssignment_pairing" CHECK (("toolRequirementId" IS NOT NULL AND "physicalToolInstanceId" IS NOT NULL AND "fixtureRequirementId" IS NULL AND "physicalFixtureInstanceId" IS NULL) OR ("fixtureRequirementId" IS NOT NULL AND "physicalFixtureInstanceId" IS NOT NULL AND "toolRequirementId" IS NULL AND "physicalToolInstanceId" IS NULL)),
  FOREIGN KEY ("verificationId") REFERENCES "OperationSetupVerification"("id") ON DELETE CASCADE,
  FOREIGN KEY ("toolRequirementId") REFERENCES "OperationToolRequirement"("id") ON DELETE RESTRICT,
  FOREIGN KEY ("fixtureRequirementId") REFERENCES "OperationFixtureRequirement"("id") ON DELETE RESTRICT,
  FOREIGN KEY ("physicalToolInstanceId") REFERENCES "PhysicalToolInstance"("id") ON DELETE RESTRICT,
  FOREIGN KEY ("physicalFixtureInstanceId") REFERENCES "PhysicalFixtureInstance"("id") ON DELETE RESTRICT
);
CREATE TABLE "OperationSetupSnapshot" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "verificationId" TEXT NOT NULL, "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("verificationId") REFERENCES "OperationSetupVerification"("id") ON DELETE RESTRICT
);
CREATE TABLE "ToolLifeEvent" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "physicalToolInstanceId" TEXT NOT NULL, "workOrderOperationId" TEXT,
  "setupSnapshotId" TEXT, "eventType" TEXT NOT NULL, "quantity" DECIMAL(18,3) NOT NULL, "idempotencyKey" TEXT NOT NULL,
  "reason" TEXT, "before" JSONB, "after" JSONB, "createdById" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ToolLifeEvent_quantity_nonnegative" CHECK ("quantity" >= 0),
  FOREIGN KEY ("physicalToolInstanceId") REFERENCES "PhysicalToolInstance"("id") ON DELETE RESTRICT,
  FOREIGN KEY ("workOrderOperationId") REFERENCES "WorkOrderOperation"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "ToolDefinition_tenantId_code_revision_key" ON "ToolDefinition"("tenantId", "code", "revision");
CREATE UNIQUE INDEX "ToolComponent_tenantId_code_revision_key" ON "ToolComponent"("tenantId", "code", "revision");
CREATE UNIQUE INDEX "ToolAssembly_tenantId_code_revision_key" ON "ToolAssembly"("tenantId", "code", "revision");
CREATE UNIQUE INDEX "ToolAssemblyComponent_toolAssemblyId_toolComponentId_key" ON "ToolAssemblyComponent"("toolAssemblyId", "toolComponentId");
CREATE UNIQUE INDEX "PhysicalToolInstance_tenantId_serialNo_key" ON "PhysicalToolInstance"("tenantId", "serialNo");
CREATE UNIQUE INDEX "PhysicalToolInstance_tenantId_barcode_key" ON "PhysicalToolInstance"("tenantId", "barcode") WHERE "barcode" IS NOT NULL;
CREATE UNIQUE INDEX "FixtureDefinition_tenantId_code_revision_key" ON "FixtureDefinition"("tenantId", "code", "revision");
CREATE UNIQUE INDEX "PhysicalFixtureInstance_tenantId_serialNo_key" ON "PhysicalFixtureInstance"("tenantId", "serialNo");
CREATE UNIQUE INDEX "PhysicalFixtureInstance_tenantId_barcode_key" ON "PhysicalFixtureInstance"("tenantId", "barcode") WHERE "barcode" IS NOT NULL;
CREATE UNIQUE INDEX "ToolMachineCompatibility_definition_unique" ON "ToolMachineCompatibility"("machineId", "toolDefinitionId") WHERE "toolDefinitionId" IS NOT NULL;
CREATE UNIQUE INDEX "ToolMachineCompatibility_assembly_unique" ON "ToolMachineCompatibility"("machineId", "toolAssemblyId") WHERE "toolAssemblyId" IS NOT NULL;
CREATE UNIQUE INDEX "FixtureMachineCompatibility_machineId_fixtureDefinitionId_key" ON "FixtureMachineCompatibility"("machineId", "fixtureDefinitionId");
CREATE INDEX "OperationSetupVerification_tenantId_workOrderOperationId_idx" ON "OperationSetupVerification"("tenantId", "workOrderOperationId");
CREATE UNIQUE INDEX "OperationSetupSnapshot_verificationId_key" ON "OperationSetupSnapshot"("verificationId");
CREATE UNIQUE INDEX "ToolLifeEvent_tenantId_idempotencyKey_key" ON "ToolLifeEvent"("tenantId", "idempotencyKey");
-- Database-level conflict protection: an active physical resource can back one setup only.
CREATE UNIQUE INDEX "OperationSetupAssignment_active_tool_reservation" ON "OperationSetupAssignment"("physicalToolInstanceId") WHERE "isActive" AND "physicalToolInstanceId" IS NOT NULL;
CREATE UNIQUE INDEX "OperationSetupAssignment_active_fixture_reservation" ON "OperationSetupAssignment"("physicalFixtureInstanceId") WHERE "isActive" AND "physicalFixtureInstanceId" IS NOT NULL;
CREATE INDEX "ToolDefinition_tenantId_isActive_idx" ON "ToolDefinition"("tenantId", "isActive");
CREATE INDEX "ToolComponent_tenantId_isActive_idx" ON "ToolComponent"("tenantId", "isActive");
CREATE INDEX "PhysicalToolInstance_tenantId_status_idx" ON "PhysicalToolInstance"("tenantId", "status");
CREATE INDEX "PhysicalFixtureInstance_tenantId_status_idx" ON "PhysicalFixtureInstance"("tenantId", "status");
CREATE INDEX "ToolMachineCompatibility_tenantId_machineId_idx" ON "ToolMachineCompatibility"("tenantId", "machineId");
CREATE INDEX "FixtureMachineCompatibility_tenantId_machineId_idx" ON "FixtureMachineCompatibility"("tenantId", "machineId");
CREATE INDEX "OperationToolRequirement_tenantId_recipeStepId_idx" ON "OperationToolRequirement"("tenantId", "recipeStepId");
CREATE INDEX "OperationToolRequirement_tenantId_workOrderOperationId_idx" ON "OperationToolRequirement"("tenantId", "workOrderOperationId");
CREATE INDEX "OperationFixtureRequirement_tenantId_recipeStepId_idx" ON "OperationFixtureRequirement"("tenantId", "recipeStepId");
CREATE INDEX "OperationFixtureRequirement_tenantId_workOrderOperationId_idx" ON "OperationFixtureRequirement"("tenantId", "workOrderOperationId");
CREATE INDEX "OperationSetupVerification_tenantId_machineId_status_idx" ON "OperationSetupVerification"("tenantId", "machineId", "status");
CREATE INDEX "OperationSetupAssignment_tenantId_verificationId_idx" ON "OperationSetupAssignment"("tenantId", "verificationId");
CREATE INDEX "ToolLifeEvent_tenantId_physicalToolInstanceId_createdAt_idx" ON "ToolLifeEvent"("tenantId", "physicalToolInstanceId", "createdAt");
CREATE INDEX "ToolLifeEvent_tenantId_workOrderOperationId_idx" ON "ToolLifeEvent"("tenantId", "workOrderOperationId");
