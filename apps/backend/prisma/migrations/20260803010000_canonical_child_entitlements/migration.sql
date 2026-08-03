-- CAT-002: split legacy commercial bundles into independently licensable child entitlements.
-- Every explicit legacy tenant choice is copied with its original enabled state;
-- tenants with no legacy row keep the service-level default of enabled.
CREATE TYPE "ProductModule_new" AS ENUM (
  'PLATFORM_DOCUMENTS', 'PLATFORM_WORKFLOW', 'PLATFORM_INTEGRATION', 'PLATFORM_OPERATIONS', 'PLATFORM_AI',
  'ERP_MASTER_DATA', 'ERP_CRM_SALES', 'ERP_PROCUREMENT', 'ERP_FINANCE', 'ERP_PROJECT_SERVICE',
  'WMS_INVENTORY_LEDGER', 'WMS_TRACEABILITY',
  'PLM_PRODUCT_STRUCTURE', 'PLM_NC_PROGRAM',
  'MES_EXECUTION', 'MES_GENEALOGY', 'MES_PERFORMANCE',
  'QMS_INSPECTION', 'QMS_NCR_CAPA', 'QMS_SPC_CALIBRATION',
  'EAM_MAINTENANCE',
  'APS_MRP', 'APS_SCHEDULING',
  'IIOT_MACHINE_CONNECT',
  'ANALYTICS_REPORTING'
);

CREATE TABLE "TenantModuleEntitlement_new" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "module" "ProductModule_new" NOT NULL,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TenantModuleEntitlement_new_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TenantModuleEntitlement_new_tenantId_module_key" UNIQUE ("tenantId", "module"),
  CONSTRAINT "TenantModuleEntitlement_new_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

WITH legacy_mapping (legacy_module, canonical_module) AS (
  VALUES
    ('MES_CORE', 'PLM_PRODUCT_STRUCTURE'), ('MES_CORE', 'MES_EXECUTION'), ('MES_CORE', 'MES_GENEALOGY'), ('MES_CORE', 'MES_PERFORMANCE'),
    ('MACHINE_CONNECT', 'IIOT_MACHINE_CONNECT'),
    ('QUALITY', 'QMS_INSPECTION'), ('QUALITY', 'QMS_NCR_CAPA'), ('QUALITY', 'QMS_SPC_CALIBRATION'),
    ('INVENTORY', 'WMS_INVENTORY_LEDGER'), ('INVENTORY', 'WMS_TRACEABILITY'),
    ('PLANNING_MRP', 'APS_MRP'), ('CAPACITY_PLANNING', 'APS_SCHEDULING'), ('MAINTENANCE', 'EAM_MAINTENANCE'),
    ('INTEGRATION_GATEWAY', 'PLATFORM_INTEGRATION'), ('REPORTING_ANALYTICS', 'ANALYTICS_REPORTING'), ('AI_COPILOT', 'PLATFORM_AI'),
    ('ERP_EXTENSIONS', 'ERP_MASTER_DATA'), ('ERP_EXTENSIONS', 'ERP_CRM_SALES'), ('ERP_EXTENSIONS', 'ERP_PROCUREMENT'), ('ERP_EXTENSIONS', 'ERP_FINANCE'), ('ERP_EXTENSIONS', 'ERP_PROJECT_SERVICE')
)
INSERT INTO "TenantModuleEntitlement_new" ("id", "tenantId", "module", "isEnabled", "updatedAt")
SELECT md5(entitlement."id" || ':' || legacy_mapping.canonical_module), entitlement."tenantId", legacy_mapping.canonical_module::"ProductModule_new", entitlement."isEnabled", entitlement."updatedAt"
FROM "TenantModuleEntitlement" entitlement
JOIN legacy_mapping ON entitlement."module"::text = legacy_mapping.legacy_module;

CREATE INDEX "TenantModuleEntitlement_new_tenantId_isEnabled_idx" ON "TenantModuleEntitlement_new"("tenantId", "isEnabled");

DROP TABLE "TenantModuleEntitlement";
DROP TYPE "ProductModule";
ALTER TYPE "ProductModule_new" RENAME TO "ProductModule";
ALTER TABLE "TenantModuleEntitlement_new" RENAME TO "TenantModuleEntitlement";
ALTER TABLE "TenantModuleEntitlement" RENAME CONSTRAINT "TenantModuleEntitlement_new_pkey" TO "TenantModuleEntitlement_pkey";
ALTER TABLE "TenantModuleEntitlement" RENAME CONSTRAINT "TenantModuleEntitlement_new_tenantId_module_key" TO "TenantModuleEntitlement_tenantId_module_key";
ALTER TABLE "TenantModuleEntitlement" RENAME CONSTRAINT "TenantModuleEntitlement_new_tenantId_fkey" TO "TenantModuleEntitlement_tenantId_fkey";
ALTER INDEX "TenantModuleEntitlement_new_tenantId_isEnabled_idx" RENAME TO "TenantModuleEntitlement_tenantId_isEnabled_idx";
