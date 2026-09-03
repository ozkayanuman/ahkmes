-- PRODUCT-ARCH-002 is expand-only. No legacy ProductModule or
-- TenantModuleEntitlement data is changed by this migration.

-- CreateEnum
CREATE TYPE "TenantLicenceStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'EXPIRED', 'REVOKED');
CREATE TYPE "EntitlementGrantStatus" AS ENUM ('ACTIVE', 'DISABLED', 'REVOKED');
CREATE TYPE "EntitlementGrantSource" AS ENUM ('DIRECT', 'BUNDLE', 'TRIAL', 'MIGRATED');
CREATE TYPE "EntitlementLimitDimension" AS ENUM ('NAMED_USER', 'CONCURRENT_USER', 'PLANT', 'MACHINE', 'API_CALL');
CREATE TYPE "EntitlementReconciliationStatus" AS ENUM ('PROJECTED', 'RECONCILED', 'NEEDS_RECONCILIATION', 'FAILED');

-- CreateTable
CREATE TABLE "TenantLicence" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "status" "TenantLicenceStatus" NOT NULL DEFAULT 'ACTIVE',
  "planRef" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "trialEndsAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TenantLicence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductGrant" (
  "id" TEXT NOT NULL,
  "tenantLicenceId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "status" "EntitlementGrantStatus" NOT NULL DEFAULT 'ACTIVE',
  "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "source" "EntitlementGrantSource" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductGrant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FeatureGrant" (
  "id" TEXT NOT NULL,
  "productGrantId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "featureId" TEXT NOT NULL,
  "status" "EntitlementGrantStatus" NOT NULL DEFAULT 'ACTIVE',
  "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "source" "EntitlementGrantSource" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FeatureGrant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EntitlementLimit" (
  "id" TEXT NOT NULL,
  "productGrantId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "dimension" "EntitlementLimitDimension" NOT NULL,
  "granted" DECIMAL(18,3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EntitlementLimit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UsageAllocation" (
  "id" TEXT NOT NULL,
  "productGrantId" TEXT,
  "tenantId" TEXT NOT NULL,
  "dimension" "EntitlementLimitDimension" NOT NULL,
  "consumed" DECIMAL(18,3) NOT NULL,
  "measuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsageAllocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EntitlementReconciliation" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "legacyCode" TEXT NOT NULL,
  "mappingVersion" TEXT NOT NULL,
  "legacyIsEnabled" BOOLEAN NOT NULL,
  "status" "EntitlementReconciliationStatus" NOT NULL,
  "projectedProductIds" JSONB NOT NULL,
  "projectedFeatureIds" JSONB NOT NULL,
  "sourceSnapshot" JSONB NOT NULL,
  "correlationId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "reason" TEXT,
  "reconciledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EntitlementReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantLicence_tenantId_key" ON "TenantLicence"("tenantId");
CREATE UNIQUE INDEX "TenantLicence_id_tenantId_key" ON "TenantLicence"("id", "tenantId");
CREATE INDEX "TenantLicence_tenantId_status_idx" ON "TenantLicence"("tenantId", "status");
CREATE UNIQUE INDEX "ProductGrant_tenantLicenceId_productId_source_key" ON "ProductGrant"("tenantLicenceId", "productId", "source");
CREATE UNIQUE INDEX "ProductGrant_id_tenantId_key" ON "ProductGrant"("id", "tenantId");
CREATE INDEX "ProductGrant_tenantId_productId_status_idx" ON "ProductGrant"("tenantId", "productId", "status");
CREATE UNIQUE INDEX "FeatureGrant_productGrantId_featureId_key" ON "FeatureGrant"("productGrantId", "featureId");
CREATE INDEX "FeatureGrant_tenantId_featureId_status_idx" ON "FeatureGrant"("tenantId", "featureId", "status");
CREATE UNIQUE INDEX "EntitlementLimit_productGrantId_dimension_key" ON "EntitlementLimit"("productGrantId", "dimension");
CREATE INDEX "EntitlementLimit_tenantId_dimension_idx" ON "EntitlementLimit"("tenantId", "dimension");
CREATE INDEX "UsageAllocation_tenantId_dimension_measuredAt_idx" ON "UsageAllocation"("tenantId", "dimension", "measuredAt");
CREATE UNIQUE INDEX "EntitlementReconciliation_tenantId_legacyCode_mappingVersion_key" ON "EntitlementReconciliation"("tenantId", "legacyCode", "mappingVersion");
CREATE INDEX "EntitlementReconciliation_tenantId_status_idx" ON "EntitlementReconciliation"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "TenantLicence" ADD CONSTRAINT "TenantLicence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductGrant" ADD CONSTRAINT "ProductGrant_tenantLicenceId_tenantId_fkey" FOREIGN KEY ("tenantLicenceId", "tenantId") REFERENCES "TenantLicence"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeatureGrant" ADD CONSTRAINT "FeatureGrant_productGrantId_tenantId_fkey" FOREIGN KEY ("productGrantId", "tenantId") REFERENCES "ProductGrant"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntitlementLimit" ADD CONSTRAINT "EntitlementLimit_productGrantId_tenantId_fkey" FOREIGN KEY ("productGrantId", "tenantId") REFERENCES "ProductGrant"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UsageAllocation" ADD CONSTRAINT "UsageAllocation_productGrantId_tenantId_fkey" FOREIGN KEY ("productGrantId", "tenantId") REFERENCES "ProductGrant"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntitlementReconciliation" ADD CONSTRAINT "EntitlementReconciliation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
