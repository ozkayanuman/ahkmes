-- PRODUCT-ARCH-003 is expand-only. It adds commercial-migration evidence,
-- approvals, run provenance, and selective rollback support. Legacy entitlement
-- data and runtime tables are deliberately untouched.

CREATE TYPE "EntitlementMigrationEvidence" AS ENUM (
  'EXPLICIT_ENABLED', 'EXPLICIT_DISABLED', 'IMPLICIT_DEFAULT_ENABLED',
  'EDITION_DERIVED', 'BUNDLE_DERIVED', 'AMBIGUOUS_SPLIT', 'NO_EVIDENCE'
);
CREATE TYPE "EntitlementMigrationDecision" AS ENUM (
  'AUTO_MIGRATABLE', 'REVIEW_REQUIRED', 'BLOCKED', 'IGNORED'
);
CREATE TYPE "EntitlementMigrationRunStatus" AS ENUM ('APPLIED', 'ROLLED_BACK');

ALTER TABLE "FeatureGrant" ADD CONSTRAINT "FeatureGrant_id_tenantId_key" UNIQUE ("id", "tenantId");
ALTER TABLE "User" ADD CONSTRAINT "User_id_tenantId_key" UNIQUE ("id", "tenantId");

ALTER TABLE "EntitlementReconciliation"
  ADD COLUMN "policyVersion" TEXT NOT NULL DEFAULT 'PRODUCT-ARCH-003-v1',
  ADD COLUMN "explicitEntitlement" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "editionContribution" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "evidenceClassification" "EntitlementMigrationEvidence" NOT NULL DEFAULT 'NO_EVIDENCE',
  ADD COLUMN "decision" "EntitlementMigrationDecision" NOT NULL DEFAULT 'BLOCKED',
  ADD COLUMN "migrationRunId" TEXT;

DROP INDEX "EntitlementReconciliation_tenantId_legacyCode_mappingVersion_key";
CREATE UNIQUE INDEX "EntitlementReconciliation_tenantId_legacyCode_mappingVersion_policyVersion_key"
  ON "EntitlementReconciliation"("tenantId", "legacyCode", "mappingVersion", "policyVersion");

CREATE TABLE "EntitlementMigrationApproval" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "legacyCode" TEXT NOT NULL,
  "mappingVersion" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "approvedProductIds" JSONB NOT NULL,
  "approvedFeatureIds" JSONB NOT NULL,
  "approvedByUserId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EntitlementMigrationApproval_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EntitlementMigrationRun" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "mappingVersion" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "status" "EntitlementMigrationRunStatus" NOT NULL DEFAULT 'APPLIED',
  "rollbackReason" TEXT,
  "rolledBackAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EntitlementMigrationRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductGrantMigrationProvenance" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "migrationRunId" TEXT NOT NULL,
  "productGrantId" TEXT NOT NULL,
  "legacyCode" TEXT NOT NULL,
  "mappingVersion" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "approvalId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "ProductGrantMigrationProvenance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FeatureGrantMigrationProvenance" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "migrationRunId" TEXT NOT NULL,
  "featureGrantId" TEXT NOT NULL,
  "legacyCode" TEXT NOT NULL,
  "mappingVersion" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "approvalId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "FeatureGrantMigrationProvenance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EntitlementMigrationApproval_id_tenantId_key" ON "EntitlementMigrationApproval"("id", "tenantId");
CREATE UNIQUE INDEX "EntitlementMigrationApproval_tenantId_legacyCode_mappingVersion_policyVersion_key"
  ON "EntitlementMigrationApproval"("tenantId", "legacyCode", "mappingVersion", "policyVersion");
CREATE INDEX "EntitlementMigrationApproval_tenantId_policyVersion_idx" ON "EntitlementMigrationApproval"("tenantId", "policyVersion");

CREATE UNIQUE INDEX "EntitlementMigrationRun_id_tenantId_key" ON "EntitlementMigrationRun"("id", "tenantId");
CREATE UNIQUE INDEX "EntitlementMigrationRun_tenantId_correlationId_key" ON "EntitlementMigrationRun"("tenantId", "correlationId");
CREATE INDEX "EntitlementMigrationRun_tenantId_status_idx" ON "EntitlementMigrationRun"("tenantId", "status");

CREATE UNIQUE INDEX "ProductGrantMigrationProvenance_migrationRunId_legacyCode_productGrantId_key"
  ON "ProductGrantMigrationProvenance"("migrationRunId", "legacyCode", "productGrantId");
CREATE INDEX "ProductGrantMigrationProvenance_tenantId_productGrantId_revokedAt_idx"
  ON "ProductGrantMigrationProvenance"("tenantId", "productGrantId", "revokedAt");
CREATE UNIQUE INDEX "FeatureGrantMigrationProvenance_migrationRunId_legacyCode_featureGrantId_key"
  ON "FeatureGrantMigrationProvenance"("migrationRunId", "legacyCode", "featureGrantId");
CREATE INDEX "FeatureGrantMigrationProvenance_tenantId_featureGrantId_revokedAt_idx"
  ON "FeatureGrantMigrationProvenance"("tenantId", "featureGrantId", "revokedAt");

ALTER TABLE "EntitlementMigrationApproval"
  ADD CONSTRAINT "EntitlementMigrationApproval_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntitlementMigrationApproval"
  ADD CONSTRAINT "EntitlementMigrationApproval_approvedByUserId_tenantId_fkey"
  FOREIGN KEY ("approvedByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EntitlementMigrationRun"
  ADD CONSTRAINT "EntitlementMigrationRun_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntitlementMigrationRun"
  ADD CONSTRAINT "EntitlementMigrationRun_actorUserId_tenantId_fkey"
  FOREIGN KEY ("actorUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductGrantMigrationProvenance"
  ADD CONSTRAINT "ProductGrantMigrationProvenance_migrationRunId_tenantId_fkey"
  FOREIGN KEY ("migrationRunId", "tenantId") REFERENCES "EntitlementMigrationRun"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductGrantMigrationProvenance"
  ADD CONSTRAINT "ProductGrantMigrationProvenance_productGrantId_tenantId_fkey"
  FOREIGN KEY ("productGrantId", "tenantId") REFERENCES "ProductGrant"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductGrantMigrationProvenance"
  ADD CONSTRAINT "ProductGrantMigrationProvenance_approvalId_tenantId_fkey"
  FOREIGN KEY ("approvalId", "tenantId") REFERENCES "EntitlementMigrationApproval"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FeatureGrantMigrationProvenance"
  ADD CONSTRAINT "FeatureGrantMigrationProvenance_migrationRunId_tenantId_fkey"
  FOREIGN KEY ("migrationRunId", "tenantId") REFERENCES "EntitlementMigrationRun"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeatureGrantMigrationProvenance"
  ADD CONSTRAINT "FeatureGrantMigrationProvenance_featureGrantId_tenantId_fkey"
  FOREIGN KEY ("featureGrantId", "tenantId") REFERENCES "FeatureGrant"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeatureGrantMigrationProvenance"
  ADD CONSTRAINT "FeatureGrantMigrationProvenance_approvalId_tenantId_fkey"
  FOREIGN KEY ("approvalId", "tenantId") REFERENCES "EntitlementMigrationApproval"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EntitlementReconciliation"
  ADD CONSTRAINT "EntitlementReconciliation_migrationRunId_tenantId_fkey"
  FOREIGN KEY ("migrationRunId", "tenantId") REFERENCES "EntitlementMigrationRun"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
