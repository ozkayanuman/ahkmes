import { PRODUCT_MODULES, type PageKey, type ProductModule } from "./enums";

export const LEGACY_PRODUCT_MODULES = [
  "PLATFORM_CORE", "MES_CORE", "MACHINE_CONNECT", "QUALITY", "INVENTORY", "PLANNING_MRP",
  "CAPACITY_PLANNING", "MAINTENANCE", "INTEGRATION_GATEWAY", "REPORTING_ANALYTICS", "AI_COPILOT", "ERP_EXTENSIONS",
] as const;
export type LegacyProductModule = (typeof LEGACY_PRODUCT_MODULES)[number];

/** Commercial suites are not entitlements themselves; their children are. */
export const PRODUCT_SUITES = ["PLATFORM", "ERP", "MES", "QMS", "WMS", "APS", "PLM", "EAM", "IIOT", "ANALYTICS"] as const;
export type ProductSuite = (typeof PRODUCT_SUITES)[number];

/** Ascending license tier order — index comparison drives editionAtLeast(). */
export const PRODUCT_EDITIONS = ["FOUNDATION", "ESSENTIALS", "PROFESSIONAL", "ENTERPRISE"] as const;
export type ProductEdition = (typeof PRODUCT_EDITIONS)[number];

/** Does tenantEdition meet or exceed requiredEdition? */
export function editionAtLeast(tenantEdition: ProductEdition, requiredEdition: ProductEdition): boolean {
  return PRODUCT_EDITIONS.indexOf(tenantEdition) >= PRODUCT_EDITIONS.indexOf(requiredEdition);
}

export const PRODUCT_IMPLEMENTATION_STATUSES = ["AVAILABLE", "BETA", "PLANNED", "MISSING"] as const;
export type ProductImplementationStatus = (typeof PRODUCT_IMPLEMENTATION_STATUSES)[number];

export interface ProductModuleDefinition {
  /** Stable canonical product code. Planned codes deliberately have no entitlement yet. */
  code: string;
  suite: ProductSuite;
  parentModule?: string;
  name: string;
  description: string;
  type: "CORE" | "MODULE";
  implementationStatus: ProductImplementationStatus;
  dependencies: readonly string[];
  requiredCore: boolean;
  tenantToggleable: boolean;
  edition: ProductEdition;
  pageCodes: readonly PageKey[];
  permissionCodes: readonly string[];
  routes: readonly string[];
  backendCapabilities: readonly string[];
  frontendAvailability: "AVAILABLE" | "PARTIAL" | "NONE";
  /** Compatibility bridge to the persisted Prisma enum; remove after CAT-002 migration. */
  entitlementCode?: LegacyProductModule;
}

const core = (code: string, name: string, description: string, pages: readonly PageKey[], routes: readonly string[], capabilities: readonly string[]): ProductModuleDefinition => ({
  code, suite: "PLATFORM", name, description, type: "CORE", implementationStatus: "AVAILABLE", dependencies: [], requiredCore: true,
  tenantToggleable: false, edition: "FOUNDATION", pageCodes: pages, permissionCodes: ["platform.read"], routes,
  backendCapabilities: capabilities, frontendAvailability: "PARTIAL",
});

/**
 * Canonical product catalogue. A record describes reality, not a promise:
 * PLANNED/MISSING modules have no route and are never tenant-toggleable.
 */
export const PRODUCT_MODULE_CATALOG: readonly ProductModuleDefinition[] = [
  { ...core("PLATFORM_CORE", "Platform Runtime", "Identity, authorization, audit and shared runtime.", ["users", "audit-log", "platform-modules", "hierarchy"], ["/users", "/audit-log", "/platform/modules"], ["JWT", "RBAC", "audit", "tenant organization"]), entitlementCode: "PLATFORM_CORE" },
  core("PLATFORM_IAM", "Identity & Access", "Authentication, session and role access management.", ["users"], ["/auth/login", "/users"], ["local JWT", "LDAP", "OIDC"]),
  core("PLATFORM_AUTHORIZATION", "Authorization", "Role, page permission and separation-of-duty foundation.", [], ["/permission-groups"], ["RBAC", "PagesGuard"]),
  core("PLATFORM_AUDIT", "Audit & Compliance", "Immutable audit foundation and approval records.", ["audit-log"], ["/audit-log", "/approvals"], ["AuditLog", "ApprovalRequest"]),
  { code: "PLATFORM_DOCUMENTS", suite: "PLATFORM", name: "Document Management", description: "Controlled documents, revisions, hashes and release workflow.", type: "MODULE", implementationStatus: "BETA", dependencies: ["PLATFORM_IAM", "PLATFORM_AUDIT"], requiredCore: false, tenantToggleable: false, edition: "PROFESSIONAL", pageCodes: [], permissionCodes: ["documents.read", "documents.write"], routes: ["/documents"], backendCapabilities: ["file upload", "attachment metadata"], frontendAvailability: "PARTIAL" },
  { code: "PLATFORM_WORKFLOW", suite: "PLATFORM", name: "Workflow & Approval", description: "Reusable BPM, tasks, escalation and electronic signature policy.", type: "MODULE", implementationStatus: "BETA", dependencies: ["PLATFORM_AUTHORIZATION", "PLATFORM_AUDIT"], requiredCore: false, tenantToggleable: false, edition: "PROFESSIONAL", pageCodes: [], permissionCodes: ["approval.decide"], routes: ["/approvals"], backendCapabilities: ["ApprovalRequest"], frontendAvailability: "PARTIAL" },
  { code: "PLATFORM_INTEGRATION", suite: "PLATFORM", name: "Integration Foundation", description: "API, webhook, credential and reliable messaging foundation.", type: "MODULE", implementationStatus: "BETA", dependencies: ["PLATFORM_AUDIT"], requiredCore: false, tenantToggleable: false, edition: "ENTERPRISE", pageCodes: ["webhooks"], permissionCodes: ["integration.manage"], routes: ["/webhooks"], backendCapabilities: ["HMAC webhook", "delivery retry/DLQ"], frontendAvailability: "PARTIAL", entitlementCode: "INTEGRATION_GATEWAY" },
  { code: "PLATFORM_OPERATIONS", suite: "PLATFORM", name: "Operations & Observability", description: "Health, logs, backup and deployment operations.", type: "MODULE", implementationStatus: "BETA", dependencies: ["PLATFORM_CORE"], requiredCore: false, tenantToggleable: false, edition: "ENTERPRISE", pageCodes: [], permissionCodes: ["operations.read"], routes: ["/health"], backendCapabilities: ["health", "Docker Compose", "backup scripts"], frontendAvailability: "NONE" },
  { code: "PLATFORM_AI", suite: "PLATFORM", name: "AI Action Platform", description: "Permission-aware draft and approval-gated action gateway.", type: "MODULE", implementationStatus: "BETA", dependencies: ["PLATFORM_AUTHORIZATION", "PLATFORM_AUDIT", "PLATFORM_WORKFLOW"], requiredCore: false, tenantToggleable: false, edition: "ENTERPRISE", pageCodes: ["copilot"], permissionCodes: ["copilot.use"], routes: ["/copilot"], backendCapabilities: ["draft suggestions only"], frontendAvailability: "PARTIAL", entitlementCode: "AI_COPILOT" },

  { code: "ERP_MASTER_DATA", suite: "ERP", name: "Master Data", description: "Materials, parts, suppliers, customers and organization master data.", type: "MODULE", implementationStatus: "AVAILABLE", dependencies: ["PLATFORM_CORE"], requiredCore: false, tenantToggleable: true, edition: "ESSENTIALS", pageCodes: ["materials", "parts", "suppliers", "customers", "hierarchy"], permissionCodes: ["master-data.read", "master-data.write"], routes: ["/materials", "/parts", "/suppliers", "/customers"], backendCapabilities: ["CRUD", "validation"], frontendAvailability: "AVAILABLE", entitlementCode: "ERP_EXTENSIONS" },
  { code: "ERP_CRM_SALES", suite: "ERP", name: "CRM & Sales", description: "Lead, quote, sales order, delivery and invoice flow.", type: "MODULE", implementationStatus: "BETA", dependencies: ["ERP_MASTER_DATA"], requiredCore: false, tenantToggleable: false, edition: "PROFESSIONAL", pageCodes: ["leads", "quotes", "sales-orders"], permissionCodes: ["sales.read", "sales.write"], routes: ["/leads", "/quotes", "/sales-orders"], backendCapabilities: ["quote", "sales order", "delivery"], frontendAvailability: "AVAILABLE", entitlementCode: "ERP_EXTENSIONS" },
  { code: "ERP_PROCUREMENT", suite: "ERP", name: "Procurement", description: "RFQ, supplier quote and purchase order workflow.", type: "MODULE", implementationStatus: "BETA", dependencies: ["ERP_MASTER_DATA"], requiredCore: false, tenantToggleable: false, edition: "PROFESSIONAL", pageCodes: ["rfq", "purchase-orders"], permissionCodes: ["purchasing.read", "purchasing.write"], routes: ["/rfq", "/purchase-orders"], backendCapabilities: ["RFQ", "purchase order", "receipt"], frontendAvailability: "AVAILABLE", entitlementCode: "ERP_EXTENSIONS" },
  { code: "ERP_FINANCE", suite: "ERP", name: "Finance", description: "AR/AP foundation; general ledger, tax, cash and statutory integrations are not implemented.", type: "MODULE", implementationStatus: "BETA", dependencies: ["ERP_MASTER_DATA"], requiredCore: false, tenantToggleable: false, edition: "ENTERPRISE", pageCodes: ["ar", "ap"], permissionCodes: ["finance.read"], routes: ["/finance"], backendCapabilities: ["AR/AP partial only"], frontendAvailability: "PARTIAL", entitlementCode: "ERP_EXTENSIONS" },
  { code: "ERP_PROJECT_SERVICE", suite: "ERP", name: "Project & Service", description: "Project production, service order, warranty and field service.", type: "MODULE", implementationStatus: "BETA", dependencies: ["ERP_MASTER_DATA"], requiredCore: false, tenantToggleable: false, edition: "PROFESSIONAL", pageCodes: ["projects", "service-tickets"], permissionCodes: ["projects.read", "service.read"], routes: ["/projects", "/service-tickets"], backendCapabilities: ["project", "service ticket"], frontendAvailability: "AVAILABLE", entitlementCode: "ERP_EXTENSIONS" },

  { code: "WMS_INVENTORY_LEDGER", suite: "WMS", name: "Inventory Ledger", description: "Immutable inventory movements and balance projections.", type: "MODULE", implementationStatus: "AVAILABLE", dependencies: ["ERP_MASTER_DATA", "PLATFORM_AUDIT"], requiredCore: false, tenantToggleable: true, edition: "ESSENTIALS", pageCodes: ["warehouses", "transfer-orders", "cycle-counts"], permissionCodes: ["inventory.read", "inventory.post"], routes: ["/inventory/movements", "/warehouses"], backendCapabilities: ["InventoryMovement", "StockBalance"], frontendAvailability: "PARTIAL", entitlementCode: "INVENTORY" },
  { code: "WMS_TRACEABILITY", suite: "WMS", name: "Lot, Serial & Traceability", description: "Lot/serial/heat and acceptance traceability.", type: "MODULE", implementationStatus: "AVAILABLE", dependencies: ["WMS_INVENTORY_LEDGER"], requiredCore: false, tenantToggleable: true, edition: "PROFESSIONAL", pageCodes: ["lots", "serial-numbers"], permissionCodes: ["traceability.read", "traceability.write"], routes: ["/lots", "/serial-numbers"], backendCapabilities: ["lot acceptance", "genealogy"], frontendAvailability: "AVAILABLE", entitlementCode: "INVENTORY" },
  { code: "WMS_ADVANCED", suite: "WMS", name: "Advanced Warehouse", description: "Putaway, picking, packing, replenishment, mobile and RFID.", type: "MODULE", implementationStatus: "MISSING", dependencies: ["WMS_INVENTORY_LEDGER"], requiredCore: false, tenantToggleable: false, edition: "PROFESSIONAL", pageCodes: [], permissionCodes: ["warehouse.execute"], routes: [], backendCapabilities: [], frontendAvailability: "NONE" },

  { code: "PLM_PRODUCT_STRUCTURE", suite: "PLM", name: "Product Structure & Routing", description: "BOM, recipe, routing and controlled revision snapshots.", type: "MODULE", implementationStatus: "BETA", dependencies: ["ERP_MASTER_DATA", "PLATFORM_DOCUMENTS"], requiredCore: false, tenantToggleable: false, edition: "PROFESSIONAL", pageCodes: ["recipes", "parts"], permissionCodes: ["plm.read", "plm.release"], routes: ["/recipes", "/parts"], backendCapabilities: ["BOM", "recipe revision", "route snapshot"], frontendAvailability: "AVAILABLE", entitlementCode: "MES_CORE" },
  { code: "PLM_CHANGE_CONTROL", suite: "PLM", name: "Engineering Change Control", description: "ECR/ECO, effective date, released revision and as-designed comparison.", type: "MODULE", implementationStatus: "MISSING", dependencies: ["PLM_PRODUCT_STRUCTURE", "PLATFORM_WORKFLOW"], requiredCore: false, tenantToggleable: false, edition: "ENTERPRISE", pageCodes: [], permissionCodes: ["plm.change.approve"], routes: [], backendCapabilities: [], frontendAvailability: "NONE" },
  { code: "PLM_NC_PROGRAM", suite: "PLM", name: "NC Program Control", description: "NC program revision, checksum, approval and release to DNC.", type: "MODULE", implementationStatus: "BETA", dependencies: ["PLM_PRODUCT_STRUCTURE", "PLATFORM_DOCUMENTS"], requiredCore: false, tenantToggleable: false, edition: "PROFESSIONAL", pageCodes: ["parts"], permissionCodes: ["nc.release"], routes: ["/parts/:id/nc-programs"], backendCapabilities: ["NC program metadata"], frontendAvailability: "PARTIAL" },

  { code: "MES_EXECUTION", suite: "MES", name: "Production Execution", description: "Work order, operation execution, WIP, partial production and scrap.", type: "MODULE", implementationStatus: "AVAILABLE", dependencies: ["PLM_PRODUCT_STRUCTURE", "WMS_INVENTORY_LEDGER"], requiredCore: false, tenantToggleable: true, edition: "ESSENTIALS", pageCodes: ["work-orders", "production", "shift-report", "labor"], permissionCodes: ["mes.execute"], routes: ["/work-orders", "/production"], backendCapabilities: ["WorkOrderOperation", "ProductionRun"], frontendAvailability: "AVAILABLE", entitlementCode: "MES_CORE" },
  { code: "MES_GENEALOGY", suite: "MES", name: "Genealogy & As-Built", description: "Forward/backward traceability across material, run and finished output.", type: "MODULE", implementationStatus: "BETA", dependencies: ["MES_EXECUTION", "WMS_TRACEABILITY"], requiredCore: false, tenantToggleable: false, edition: "PROFESSIONAL", pageCodes: ["genealogy"], permissionCodes: ["genealogy.read"], routes: ["/work-orders/:id/genealogy"], backendCapabilities: ["work-order genealogy"], frontendAvailability: "AVAILABLE", entitlementCode: "MES_CORE" },
  { code: "MES_OPERATOR_HMI", suite: "MES", name: "Operator HMI", description: "Machine-specific dispatch and guided operation execution terminal.", type: "MODULE", implementationStatus: "BETA", dependencies: ["MES_EXECUTION", "PLM_NC_PROGRAM", "MES_CNC_TOOLING"], requiredCore: false, tenantToggleable: false, edition: "PROFESSIONAL", pageCodes: ["hmi-operations"], permissionCodes: ["HMI_READ", "HMI_START", "HMI_COMPLETE"], routes: ["/hmi/operations"], backendCapabilities: ["tenant operation queue", "canonical start/complete delegation", "NC/tooling checklist"], frontendAvailability: "AVAILABLE", entitlementCode: "MES_CORE" },
  { code: "MES_PERFORMANCE", suite: "MES", name: "OEE & Shop-floor Performance", description: "OEE, downtime, shift performance and production KPI.", type: "MODULE", implementationStatus: "BETA", dependencies: ["MES_EXECUTION", "IIOT_MACHINE_CONNECT"], requiredCore: false, tenantToggleable: false, edition: "PROFESSIONAL", pageCodes: ["production"], permissionCodes: ["oee.read"], routes: ["/work-orders/:id/oee"], backendCapabilities: ["OEE calculation"], frontendAvailability: "PARTIAL", entitlementCode: "MES_CORE" },
  { code: "MES_CNC_TOOLING", suite: "MES", name: "CNC Tooling & Fixture", description: "Tool, assembly, fixture, life, compatibility and verified operation setup.", type: "MODULE", implementationStatus: "BETA", dependencies: ["MES_EXECUTION", "ERP_MASTER_DATA", "PLM_NC_PROGRAM"], requiredCore: false, tenantToggleable: false, edition: "PROFESSIONAL", pageCodes: ["tooling"], permissionCodes: ["tooling.read", "tooling.manage", "tooling.assembly.manage", "tooling.life.adjust", "tooling.fixture.manage", "tooling.setup.manage", "tooling.setup.verify"], routes: ["/tooling"], backendCapabilities: ["tool definitions", "fixture definitions", "setup verification", "tool life"], frontendAvailability: "AVAILABLE" },
  { code: "MES_DNC", suite: "MES", name: "DNC & NC Distribution", description: "Approved NC distribution, collection and wrong-program prevention.", type: "MODULE", implementationStatus: "MISSING", dependencies: ["PLM_NC_PROGRAM", "IIOT_MACHINE_CONNECT"], requiredCore: false, tenantToggleable: false, edition: "ENTERPRISE", pageCodes: [], permissionCodes: ["dnc.deploy"], routes: [], backendCapabilities: [], frontendAvailability: "NONE" },

  { code: "QMS_INSPECTION", suite: "QMS", name: "Inspection & Control Plans", description: "Incoming, in-process and final inspection with control plans.", type: "MODULE", implementationStatus: "BETA", dependencies: ["MES_EXECUTION", "WMS_TRACEABILITY"], requiredCore: false, tenantToggleable: false, edition: "PROFESSIONAL", pageCodes: ["inspections"], permissionCodes: ["quality.inspect"], routes: ["/inspections"], backendCapabilities: ["Inspection", "QualityPlan"], frontendAvailability: "AVAILABLE", entitlementCode: "QUALITY" },
  { code: "QMS_NCR_CAPA", suite: "QMS", name: "NCR, Deviation & CAPA", description: "Nonconformance, disposition, deviation and corrective action.", type: "MODULE", implementationStatus: "BETA", dependencies: ["QMS_INSPECTION", "PLATFORM_WORKFLOW"], requiredCore: false, tenantToggleable: false, edition: "PROFESSIONAL", pageCodes: ["non-conformances", "capa"], permissionCodes: ["quality.ncr"], routes: ["/non-conformances", "/capa"], backendCapabilities: ["NCR", "CAPA"], frontendAvailability: "AVAILABLE", entitlementCode: "QUALITY" },
  { code: "QMS_SPC_CALIBRATION", suite: "QMS", name: "SPC & Calibration", description: "SPC, instruments and calibration history.", type: "MODULE", implementationStatus: "BETA", dependencies: ["QMS_INSPECTION"], requiredCore: false, tenantToggleable: false, edition: "PROFESSIONAL", pageCodes: ["spc", "calibrations"], permissionCodes: ["quality.spc", "calibration.manage"], routes: ["/spc", "/calibrations"], backendCapabilities: ["SPC", "Calibration"], frontendAvailability: "AVAILABLE", entitlementCode: "QUALITY" },
  { code: "QMS_ADVANCED", suite: "QMS", name: "Advanced Quality", description: "Sampling, MRB, FAI/AS9102, Gauge R&R, supplier quality and complaints.", type: "MODULE", implementationStatus: "MISSING", dependencies: ["QMS_INSPECTION"], requiredCore: false, tenantToggleable: false, edition: "ENTERPRISE", pageCodes: [], permissionCodes: ["quality.mrb"], routes: [], backendCapabilities: [], frontendAvailability: "NONE" },

  { code: "EAM_MAINTENANCE", suite: "EAM", name: "Maintenance Execution", description: "Asset, preventive/corrective maintenance, runtime and history.", type: "MODULE", implementationStatus: "BETA", dependencies: ["ERP_MASTER_DATA"], requiredCore: false, tenantToggleable: true, edition: "PROFESSIONAL", pageCodes: ["maintenance-orders", "energy"], permissionCodes: ["maintenance.execute"], routes: ["/maintenance-orders"], backendCapabilities: ["maintenance order", "energy"], frontendAvailability: "AVAILABLE", entitlementCode: "MAINTENANCE" },
  { code: "EAM_RELIABILITY", suite: "EAM", name: "Reliability & Spares", description: "Condition maintenance, spares, downtime, MTBF and MTTR.", type: "MODULE", implementationStatus: "MISSING", dependencies: ["EAM_MAINTENANCE", "IIOT_MACHINE_CONNECT"], requiredCore: false, tenantToggleable: false, edition: "ENTERPRISE", pageCodes: [], permissionCodes: ["maintenance.plan"], routes: [], backendCapabilities: [], frontendAvailability: "NONE" },

  { code: "APS_MRP", suite: "APS", name: "MRP", description: "Demand, BOM explosion and purchase/production proposals.", type: "MODULE", implementationStatus: "BETA", dependencies: ["ERP_MASTER_DATA", "WMS_INVENTORY_LEDGER", "PLM_PRODUCT_STRUCTURE"], requiredCore: false, tenantToggleable: false, edition: "PROFESSIONAL", pageCodes: ["mrp"], permissionCodes: ["mrp.run"], routes: ["/mrp"], backendCapabilities: ["net requirements"], frontendAvailability: "AVAILABLE", entitlementCode: "PLANNING_MRP" },
  { code: "APS_SCHEDULING", suite: "APS", name: "Finite Scheduling", description: "Capacity model, dispatch, finite scheduling and what-if scenarios.", type: "MODULE", implementationStatus: "BETA", dependencies: ["APS_MRP", "MES_EXECUTION", "EAM_MAINTENANCE"], requiredCore: false, tenantToggleable: false, edition: "ENTERPRISE", pageCodes: ["scheduling"], permissionCodes: ["aps.schedule"], routes: ["/scheduling"], backendCapabilities: ["manual scheduling only"], frontendAvailability: "PARTIAL", entitlementCode: "CAPACITY_PLANNING" },

  { code: "IIOT_MACHINE_CONNECT", suite: "IIOT", name: "Machine Connect & Edge", description: "Machine registry, edge connector, telemetry and store-and-forward.", type: "MODULE", implementationStatus: "BETA", dependencies: ["PLATFORM_INTEGRATION"], requiredCore: false, tenantToggleable: false, edition: "PROFESSIONAL", pageCodes: ["machines", "automation-gateway", "digital-twin"], permissionCodes: ["machine.connect"], routes: ["/machines", "/automation-gateway"], backendCapabilities: ["OPC UA", "M80 experimental", "simulator"], frontendAvailability: "AVAILABLE", entitlementCode: "MACHINE_CONNECT" },
  { code: "IIOT_HISTORIAN", suite: "IIOT", name: "Historian & Telemetry Quality", description: "Time-series retention, synchronization and telemetry quality policy.", type: "MODULE", implementationStatus: "MISSING", dependencies: ["IIOT_MACHINE_CONNECT"], requiredCore: false, tenantToggleable: false, edition: "ENTERPRISE", pageCodes: [], permissionCodes: ["telemetry.read"], routes: [], backendCapabilities: [], frontendAvailability: "NONE" },

  { code: "ANALYTICS_REPORTING", suite: "ANALYTICS", name: "Reporting & Dashboards", description: "Operational reports, dashboard and export.", type: "MODULE", implementationStatus: "BETA", dependencies: ["PLATFORM_CORE"], requiredCore: false, tenantToggleable: false, edition: "ESSENTIALS", pageCodes: ["reports"], permissionCodes: ["reports.read"], routes: ["/reports"], backendCapabilities: ["CSV export", "basic reports"], frontendAvailability: "AVAILABLE", entitlementCode: "REPORTING_ANALYTICS" },
  { code: "ANALYTICS_SEMANTIC_BI", suite: "ANALYTICS", name: "Semantic BI", description: "Data mart, scheduled reports, KPI targets and external BI integration.", type: "MODULE", implementationStatus: "MISSING", dependencies: ["ANALYTICS_REPORTING"], requiredCore: false, tenantToggleable: false, edition: "ENTERPRISE", pageCodes: [], permissionCodes: ["bi.manage"], routes: [], backendCapabilities: [], frontendAvailability: "NONE" },
] as const;

/** Explicit, reviewable backfill policy for the CAT-002 legacy-enum migration. */
export const LEGACY_PRODUCT_MODULE_MIGRATION: Record<LegacyProductModule, readonly ProductModule[]> = {
  PLATFORM_CORE: [],
  MES_CORE: ["PLM_PRODUCT_STRUCTURE", "MES_EXECUTION", "MES_GENEALOGY", "MES_PERFORMANCE"],
  MACHINE_CONNECT: ["IIOT_MACHINE_CONNECT"],
  QUALITY: ["QMS_INSPECTION", "QMS_NCR_CAPA", "QMS_SPC_CALIBRATION"],
  INVENTORY: ["WMS_INVENTORY_LEDGER", "WMS_TRACEABILITY"],
  PLANNING_MRP: ["APS_MRP"],
  CAPACITY_PLANNING: ["APS_SCHEDULING"],
  MAINTENANCE: ["EAM_MAINTENANCE"],
  INTEGRATION_GATEWAY: ["PLATFORM_INTEGRATION"],
  REPORTING_ANALYTICS: ["ANALYTICS_REPORTING"],
  AI_COPILOT: ["PLATFORM_AI"],
  ERP_EXTENSIONS: ["ERP_MASTER_DATA", "ERP_CRM_SALES", "ERP_PROCUREMENT", "ERP_FINANCE", "ERP_PROJECT_SERVICE"],
};

export interface EntitlementModuleDefinition {
  code: ProductModule;
  suite: ProductSuite;
  name: string;
  description: string;
  requiredCore: boolean;
  tenantToggleable: boolean;
  implementationStatus: ProductImplementationStatus;
  canonicalModules: readonly ProductModule[];
}

export const ENTITLEMENT_MODULE_CATALOG: readonly EntitlementModuleDefinition[] = PRODUCT_MODULE_CATALOG
  .filter((definition) => definition.type === "MODULE"
    && ["AVAILABLE", "BETA"].includes(definition.implementationStatus)
    && PRODUCT_MODULES.includes(definition.code as ProductModule))
  .map((definition) => ({
    code: definition.code as ProductModule,
    suite: definition.suite,
    name: definition.name,
    description: definition.description,
    requiredCore: false,
    tenantToggleable: true,
    implementationStatus: definition.implementationStatus,
    canonicalModules: [definition.code as ProductModule],
  }));

export function getEntitlementModuleDefinition(code: ProductModule) {
  return ENTITLEMENT_MODULE_CATALOG.find((definition) => definition.code === code);
}
