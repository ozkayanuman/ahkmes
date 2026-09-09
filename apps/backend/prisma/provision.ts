import { ProductModule, PrismaClient, Role } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

const prisma = new PrismaClient();

const CNC_PROFESSIONAL_MODULES: ProductModule[] = [
  "PLATFORM_DOCUMENTS", "PLATFORM_WORKFLOW", "PLATFORM_INTEGRATION", "PLATFORM_OPERATIONS",
  "ERP_MASTER_DATA", "WMS_INVENTORY_LEDGER", "WMS_TRACEABILITY", "PLM_PRODUCT_STRUCTURE", "PLM_NC_PROGRAM",
  "MES_EXECUTION", "MES_CNC_TOOLING", "MES_GENEALOGY", "MES_PERFORMANCE",
  "QMS_INSPECTION", "QMS_NCR_CAPA", "QMS_SPC_CALIBRATION", "EAM_MAINTENANCE", "APS_MRP",
  "IIOT_MACHINE_CONNECT", "ANALYTICS_REPORTING",
];

const actionGrants: Array<[string, Role]> = [
  ["TOOL_READ", "ADMIN"], ["TOOL_READ", "PLANNER"], ["TOOL_READ", "FOREMAN"], ["TOOL_READ", "OPERATOR"],
  ["FIXTURE_READ", "ADMIN"], ["FIXTURE_READ", "PLANNER"], ["FIXTURE_READ", "FOREMAN"], ["FIXTURE_READ", "OPERATOR"],
  ["TOOL_MANAGE", "ADMIN"], ["TOOL_MANAGE", "PLANNER"], ["TOOL_ASSEMBLY_MANAGE", "ADMIN"], ["TOOL_ASSEMBLY_MANAGE", "PLANNER"],
  ["TOOL_LIFE_ADJUST", "ADMIN"], ["FIXTURE_MANAGE", "ADMIN"], ["FIXTURE_MANAGE", "PLANNER"],
  ["OPERATION_SETUP_MANAGE", "ADMIN"], ["OPERATION_SETUP_MANAGE", "PLANNER"], ["OPERATION_SETUP_MANAGE", "FOREMAN"],
  ["OPERATION_SETUP_VERIFY", "ADMIN"], ["OPERATION_SETUP_VERIFY", "FOREMAN"],
  ["FIXTURE_MAINT_MANAGE", "ADMIN"], ["FIXTURE_MAINT_MANAGE", "PLANNER"],
  ["FIXTURE_CALIBRATION_RECORD", "ADMIN"], ["FIXTURE_CALIBRATION_RECORD", "PLANNER"], ["FIXTURE_CALIBRATION_RECORD", "FOREMAN"],
  ["FIXTURE_MAINT_OVERRIDE", "ADMIN"],
  ["HMI_READ", "ADMIN"], ["HMI_READ", "PLANNER"], ["HMI_READ", "FOREMAN"], ["HMI_READ", "OPERATOR"],
  ["HMI_START", "ADMIN"], ["HMI_START", "PLANNER"], ["HMI_START", "FOREMAN"], ["HMI_START", "OPERATOR"],
  ["HMI_COMPLETE", "ADMIN"], ["HMI_COMPLETE", "PLANNER"], ["HMI_COMPLETE", "FOREMAN"], ["HMI_COMPLETE", "OPERATOR"],
  ["HMI_SETUP", "ADMIN"], ["HMI_SETUP", "PLANNER"], ["HMI_SETUP", "FOREMAN"], ["HMI_SETUP", "OPERATOR"],
  ["HMI_PAUSE", "ADMIN"], ["HMI_PAUSE", "PLANNER"], ["HMI_PAUSE", "FOREMAN"], ["HMI_PAUSE", "OPERATOR"],
  ["HMI_RESUME", "ADMIN"], ["HMI_RESUME", "PLANNER"], ["HMI_RESUME", "FOREMAN"], ["HMI_RESUME", "OPERATOR"],
  ["HMI_REPORT", "ADMIN"], ["HMI_REPORT", "PLANNER"], ["HMI_REPORT", "FOREMAN"], ["HMI_REPORT", "OPERATOR"],
  ["HMI_HOLD", "ADMIN"], ["HMI_HOLD", "PLANNER"], ["HMI_HOLD", "FOREMAN"],
  ["HMI_HOLD_RELEASE", "ADMIN"], ["HMI_HOLD_RELEASE", "PLANNER"], ["HMI_HOLD_RELEASE", "FOREMAN"],
  ["HMI_REWORK", "ADMIN"], ["HMI_REWORK", "PLANNER"], ["HMI_REWORK", "FOREMAN"],
  ["MRP_READ", "ADMIN"], ["MRP_READ", "PLANNER"], ["MRP_RUN", "ADMIN"], ["MRP_RUN", "PLANNER"],
  ["MRP_FIRM", "ADMIN"], ["MRP_FIRM", "PLANNER"], ["MRP_CONVERT_MAKE", "ADMIN"], ["MRP_CONVERT_MAKE", "PLANNER"],
  ["MRP_CONVERT_BUY", "ADMIN"], ["MRP_CONVERT_BUY", "PLANNER"], ["MRP_ADMIN_PARAMETERS", "ADMIN"], ["MRP_ADMIN_PARAMETERS", "PLANNER"],
  ["CMMS_READ", "ADMIN"], ["CMMS_READ", "PLANNER"], ["CMMS_READ", "FOREMAN"],
  ["CMMS_REQUEST_CREATE", "ADMIN"], ["CMMS_REQUEST_CREATE", "PLANNER"], ["CMMS_REQUEST_CREATE", "FOREMAN"], ["CMMS_REQUEST_CREATE", "OPERATOR"],
  ["CMMS_BREAKDOWN_DECLARE", "ADMIN"], ["CMMS_BREAKDOWN_DECLARE", "PLANNER"], ["CMMS_BREAKDOWN_DECLARE", "FOREMAN"], ["CMMS_BREAKDOWN_DECLARE", "OPERATOR"],
  ["CMMS_WO_PLAN", "ADMIN"], ["CMMS_WO_PLAN", "PLANNER"], ["CMMS_WO_EXECUTE", "ADMIN"], ["CMMS_WO_EXECUTE", "PLANNER"], ["CMMS_WO_EXECUTE", "FOREMAN"],
  ["CMMS_ASSIGN_TECHNICIAN", "ADMIN"], ["CMMS_ASSIGN_TECHNICIAN", "PLANNER"], ["CMMS_ASSIGN_TECHNICIAN", "FOREMAN"],
  ["CMMS_SPARE_ISSUE", "ADMIN"], ["CMMS_SPARE_ISSUE", "PLANNER"], ["CMMS_SPARE_ISSUE", "FOREMAN"],
  ["CMMS_PM_ADMIN", "ADMIN"], ["CMMS_PM_ADMIN", "PLANNER"], ["CMMS_RETURN_TO_SERVICE", "ADMIN"], ["CMMS_RETURN_TO_SERVICE", "FOREMAN"], ["CMMS_CODE_ADMIN", "ADMIN"],
];

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be explicitly provided for customer provisioning`);
  return value;
}

function parseModules() {
  const supplied = process.env.BOOTSTRAP_LEGACY_MODULES;
  if (!supplied) return CNC_PROFESSIONAL_MODULES;
  const known = new Set(Object.values(ProductModule));
  const modules = supplied.split(",").map((value) => value.trim()).filter(Boolean) as ProductModule[];
  if (modules.length === 0 || modules.some((module) => !known.has(module))) {
    throw new Error("BOOTSTRAP_LEGACY_MODULES must be a comma-separated list of current ProductModule values");
  }
  return [...new Set(modules)];
}

async function main() {
  const tenantName = required("BOOTSTRAP_TENANT_NAME");
  const tenantCode = required("BOOTSTRAP_TENANT_CODE").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(tenantCode)) throw new Error("BOOTSTRAP_TENANT_CODE must use lowercase letters, digits and hyphens");
  const adminEmail = required("BOOTSTRAP_ADMIN_EMAIL").toLowerCase();
  const adminPassword = required("BOOTSTRAP_ADMIN_PASSWORD");
  if (adminPassword.length < 12) throw new Error("BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters");
  const adminName = required("BOOTSTRAP_ADMIN_NAME");
  const plantName = required("BOOTSTRAP_PLANT_NAME");
  const locale = process.env.BOOTSTRAP_LOCALE?.trim() || "tr";
  const timezone = process.env.BOOTSTRAP_TIMEZONE?.trim() || "Europe/Istanbul";
  const edition = (process.env.BOOTSTRAP_EDITION?.trim() || "PROFESSIONAL") as "FOUNDATION" | "ESSENTIALS" | "PROFESSIONAL" | "ENTERPRISE";
  if (!["FOUNDATION", "ESSENTIALS", "PROFESSIONAL", "ENTERPRISE"].includes(edition)) throw new Error("BOOTSTRAP_EDITION is invalid");
  const enabledModules = parseModules();

  // Provisioning legitimately creates a complete permission baseline. Keep the
  // atomic boundary, but do not rely on Prisma's short default transaction
  // timeout on a freshly migrated customer database.
  const result = await prisma.$transaction(async (tx) => {
    const existingTenant = await tx.tenant.findUnique({ where: { code: tenantCode } });
    if (existingTenant && existingTenant.name !== tenantName) throw new Error(`Tenant code '${tenantCode}' already belongs to a different tenant`);
    const tenant = existingTenant ?? await tx.tenant.create({ data: { name: tenantName, code: tenantCode, locale, timezone, edition } });

    const sameEmail = await tx.user.findUnique({ where: { email: adminEmail } });
    if (sameEmail && sameEmail.tenantId !== tenant.id) throw new Error("BOOTSTRAP_ADMIN_EMAIL already belongs to another tenant");
    const admin = sameEmail ?? await tx.user.create({
      data: { tenantId: tenant.id, email: adminEmail, passwordHash: await bcrypt.hash(adminPassword, 12), name: adminName, role: "ADMIN", locale, timezone },
    });

    await tx.plant.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: plantName } },
      update: {},
      create: { tenantId: tenant.id, name: plantName, code: process.env.BOOTSTRAP_PLANT_CODE?.trim() || null },
    });

    for (const module of Object.values(ProductModule)) {
      await tx.tenantModuleEntitlement.upsert({
        where: { tenantId_module: { tenantId: tenant.id, module } },
        update: { isEnabled: enabledModules.includes(module) },
        create: { tenantId: tenant.id, module, isEnabled: enabledModules.includes(module) },
      });
    }
    for (const [action, role] of actionGrants) {
      const exists = await tx.actionPermissionGrant.findFirst({ where: { tenantId: tenant.id, action, role } });
      if (!exists) await tx.actionPermissionGrant.create({ data: { tenantId: tenant.id, action, role, createdById: admin.id } });
    }
    const connectorEmail = `machine-connector+${tenantCode}@ahkmes.local`;
    const connector = await tx.user.findUnique({ where: { email: connectorEmail } });
    if (!connector) await tx.user.create({
      data: { tenantId: tenant.id, email: connectorEmail, passwordHash: await bcrypt.hash(randomUUID(), 12), name: "Machine Connector", role: "OPERATOR", locale, timezone },
    });
    if (!existingTenant) {
      await tx.auditLog.create({ data: { tenantId: tenant.id, userId: admin.id, entity: "tenant-provisioning", entityId: tenant.id, action: "CREATE", after: { tenantCode, edition, enabledLegacyModules: enabledModules, plantName } } });
    }
    return { tenant, admin, created: !existingTenant };
  }, { timeout: 20_000, maxWait: 10_000 });

  // V2 licence/grant tables are intentionally not touched: legacy ProductModule
  // remains the current production authorization authority.
  console.log(JSON.stringify({ status: "ok", tenantId: result.tenant.id, tenantCode, adminEmail: result.admin.email, created: result.created }));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
