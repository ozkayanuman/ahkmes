CREATE TYPE "ProductModule" AS ENUM ('PLATFORM_CORE', 'MES_CORE', 'MACHINE_CONNECT', 'QUALITY', 'INVENTORY', 'PLANNING_MRP', 'CAPACITY_PLANNING', 'MAINTENANCE', 'INTEGRATION_GATEWAY', 'REPORTING_ANALYTICS', 'AI_COPILOT', 'ERP_EXTENSIONS');
CREATE TABLE "TenantModuleEntitlement" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "module" "ProductModule" NOT NULL,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TenantModuleEntitlement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TenantModuleEntitlement_tenantId_module_key" ON "TenantModuleEntitlement"("tenantId", "module");
CREATE INDEX "TenantModuleEntitlement_tenantId_isEnabled_idx" ON "TenantModuleEntitlement"("tenantId", "isEnabled");
ALTER TABLE "TenantModuleEntitlement" ADD CONSTRAINT "TenantModuleEntitlement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
