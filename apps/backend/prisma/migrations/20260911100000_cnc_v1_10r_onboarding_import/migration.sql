-- CNC-V1-10R: retained dry-run evidence and atomic onboarding imports.
CREATE TYPE "OnboardingImportTemplate" AS ENUM (
  'PARTS', 'MATERIALS', 'TOOL_DEFINITIONS', 'TOOL_COMPONENTS', 'FIXTURE_DEFINITIONS', 'PHYSICAL_TOOLS', 'PHYSICAL_FIXTURES', 'TOOL_MACHINE_COMPATIBILITIES', 'FIXTURE_MACHINE_COMPATIBILITIES', 'BOMS', 'ROUTINGS', 'CUSTOMERS', 'SUPPLIERS', 'MACHINES', 'WAREHOUSES', 'OPENING_STOCK'
);

CREATE TYPE "OnboardingImportMode" AS ENUM ('DRY_RUN', 'COMMIT');
CREATE TYPE "OnboardingImportStatus" AS ENUM ('VALIDATED', 'REJECTED', 'COMMITTED');

CREATE TABLE "OnboardingImportBatch" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "template" "OnboardingImportTemplate" NOT NULL,
  "mode" "OnboardingImportMode" NOT NULL,
  "status" "OnboardingImportStatus" NOT NULL,
  "sourceChecksum" TEXT NOT NULL,
  "totalRows" INTEGER NOT NULL,
  "validRows" INTEGER NOT NULL,
  "createdRows" INTEGER NOT NULL DEFAULT 0,
  "failureReason" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "committedAt" TIMESTAMP(3),
  CONSTRAINT "OnboardingImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OnboardingImportRowResult" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "externalKey" TEXT,
  "status" TEXT NOT NULL,
  "normalized" JSONB,
  "errors" JSONB,
  "createdEntityId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OnboardingImportRowResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OnboardingImportBatch_id_tenantId_key" ON "OnboardingImportBatch"("id", "tenantId");
CREATE INDEX "OnboardingImportBatch_tenantId_template_createdAt_idx" ON "OnboardingImportBatch"("tenantId", "template", "createdAt");
CREATE UNIQUE INDEX "OnboardingImportRowResult_batchId_rowNumber_key" ON "OnboardingImportRowResult"("batchId", "rowNumber");
CREATE INDEX "OnboardingImportRowResult_tenantId_batchId_idx" ON "OnboardingImportRowResult"("tenantId", "batchId");

ALTER TABLE "OnboardingImportBatch"
  ADD CONSTRAINT "OnboardingImportBatch_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OnboardingImportBatch"
  ADD CONSTRAINT "OnboardingImportBatch_createdById_tenantId_fkey"
  FOREIGN KEY ("createdById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OnboardingImportRowResult"
  ADD CONSTRAINT "OnboardingImportRowResult_batchId_tenantId_fkey"
  FOREIGN KEY ("batchId", "tenantId") REFERENCES "OnboardingImportBatch"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
