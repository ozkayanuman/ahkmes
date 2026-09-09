/**
 * PRODUCT-ARCH-001 commercial catalogue foundation.
 *
 * This is intentionally separate from product-catalog.ts. That file remains the
 * current technical catalogue and tenant-module entitlement source of truth.
 * Nothing in this file grants, denies, persists, or projects an entitlement.
 */

export const PLATFORM_CAPABILITY_IDS = [
  "PLATFORM_CORE",
  "ENTITLEMENT_RUNTIME",
  "SHARED_MASTER_DATA",
  "PLATFORM_AUDIT",
  "PLATFORM_DOCUMENTS",
  "PLATFORM_WORKFLOW",
  "PLATFORM_INTEGRATION",
  "PLATFORM_NOTIFICATION",
  "PLATFORM_OPERATIONS",
] as const;
export type PlatformCapabilityId = (typeof PLATFORM_CAPABILITY_IDS)[number];

export interface PlatformCapabilityDefinition {
  id: PlatformCapabilityId;
  name: string;
  description: string;
  independentlySellable: false;
}

/** Internal capabilities only. SHARED_MASTER_DATA is canonical platform data, never an ERP SKU. */
export const PLATFORM_CAPABILITIES: readonly PlatformCapabilityDefinition[] = [
  { id: "PLATFORM_CORE", name: "Platform Core", description: "Tenant context, identity, authorization, and shared runtime foundations.", independentlySellable: false },
  { id: "ENTITLEMENT_RUNTIME", name: "Entitlement Runtime", description: "Future product and feature grant resolution contract; the current module runtime remains unchanged.", independentlySellable: false },
  { id: "SHARED_MASTER_DATA", name: "Shared Master Data", description: "Canonical item, UOM, site, resource, warehouse, party, person, calendar, and reference identities; this is platform capability, not ERP functionality.", independentlySellable: false },
  { id: "PLATFORM_AUDIT", name: "Platform Audit", description: "Explicit audit and compliance capability used by platform and product workflows.", independentlySellable: false },
  { id: "PLATFORM_DOCUMENTS", name: "Platform Documents", description: "Document storage, metadata, access, and controlled-document substrate.", independentlySellable: false },
  { id: "PLATFORM_WORKFLOW", name: "Platform Workflow", description: "Reusable approval, task, escalation, and electronic-signature policy primitives.", independentlySellable: false },
  { id: "PLATFORM_INTEGRATION", name: "Platform Integration", description: "API, event, adapter, idempotency, and delivery contracts.", independentlySellable: false },
  { id: "PLATFORM_NOTIFICATION", name: "Platform Notification", description: "In-app and channel-neutral notification intent and delivery policy.", independentlySellable: false },
  { id: "PLATFORM_OPERATIONS", name: "Platform Operations", description: "Health, observability, backup/recovery, and deployment operations.", independentlySellable: false },
];

/** A dependency graph for platform capabilities only; it contains no commercial product edges. */
export const PLATFORM_CAPABILITY_DEPENDENCY_GRAPH: Readonly<Record<PlatformCapabilityId, readonly PlatformCapabilityId[]>> = {
  PLATFORM_CORE: [],
  ENTITLEMENT_RUNTIME: ["PLATFORM_CORE", "PLATFORM_AUDIT"],
  SHARED_MASTER_DATA: ["PLATFORM_CORE", "PLATFORM_AUDIT"],
  PLATFORM_AUDIT: ["PLATFORM_CORE"],
  PLATFORM_DOCUMENTS: ["PLATFORM_CORE", "PLATFORM_AUDIT"],
  PLATFORM_WORKFLOW: ["PLATFORM_CORE", "PLATFORM_AUDIT"],
  PLATFORM_INTEGRATION: ["PLATFORM_CORE", "PLATFORM_AUDIT"],
  PLATFORM_NOTIFICATION: ["PLATFORM_CORE"],
  PLATFORM_OPERATIONS: ["PLATFORM_CORE", "PLATFORM_AUDIT"],
};

export const COMMERCIAL_PRODUCT_IDS = [
  "CRM", "SALES", "PROCUREMENT", "INVENTORY", "WMS", "MRP", "MRP_II", "APS", "MES", "CNC", "TOOLING", "FIXTURE",
  "QMS", "CMMS", "OEE", "PLM", "COSTING", "FINANCE", "HR", "PROJECT", "SERVICE", "SCM", "TMS", "ANALYTICS", "AI",
] as const;
export type CommercialProductId = (typeof COMMERCIAL_PRODUCT_IDS)[number];

export const PRODUCT_COMMERCIAL_STATUSES = ["PLANNED", "FOUNDATION", "PARTIAL", "AVAILABLE"] as const;
export type ProductCommercialStatus = (typeof PRODUCT_COMMERCIAL_STATUSES)[number];

export const PROVIDER_REQUIREMENT_IDS = [
  "PROCESS_DEFINITION_PROVIDER",
  "INVENTORY_EXECUTION_PROVIDER",
  "RESOURCE_CONTEXT_PROVIDER",
  "OPERATION_CONTEXT_PROVIDER",
  "DEMAND_PROVIDER",
  "BOM_PROVIDER",
  "STOCK_PROVIDER",
  "NC_PROGRAM_PROVIDER",
  "MACHINE_DATA_PROVIDER",
] as const;
export type ProviderRequirementId = (typeof PROVIDER_REQUIREMENT_IDS)[number];

export interface ProviderRequirementDefinition {
  id: ProviderRequirementId;
  description: string;
  mayBeSatisfiedExternally: true;
}

/** Provider requirements are integration contracts, not AHK product licences. */
export const PROVIDER_REQUIREMENTS: readonly ProviderRequirementDefinition[] = [
  { id: "PROCESS_DEFINITION_PROVIDER", description: "Released process, routing, and work-instruction context.", mayBeSatisfiedExternally: true },
  { id: "INVENTORY_EXECUTION_PROVIDER", description: "Inventory reservation, consumption, and production-posting execution.", mayBeSatisfiedExternally: true },
  { id: "RESOURCE_CONTEXT_PROVIDER", description: "Plant, work-center, resource, and availability context.", mayBeSatisfiedExternally: true },
  { id: "OPERATION_CONTEXT_PROVIDER", description: "Current operation and job context for machine-facing execution.", mayBeSatisfiedExternally: true },
  { id: "DEMAND_PROVIDER", description: "Demand, order, forecast, or independent requirement source.", mayBeSatisfiedExternally: true },
  { id: "BOM_PROVIDER", description: "Released bill-of-material source.", mayBeSatisfiedExternally: true },
  { id: "STOCK_PROVIDER", description: "Usable stock, supply, and allocation source.", mayBeSatisfiedExternally: true },
  { id: "NC_PROGRAM_PROVIDER", description: "Approved NC program and revision source.", mayBeSatisfiedExternally: true },
  { id: "MACHINE_DATA_PROVIDER", description: "Machine capability, state, telemetry, and event source.", mayBeSatisfiedExternally: true },
];

export interface ProductProviderRequirement {
  requirementId: ProviderRequirementId;
  mode: "REQUIRED" | "OPTIONAL";
}

export const PRODUCT_FEATURE_IDS = [
  "MES_EXECUTION", "MES_OPERATOR_HMI", "MES_GENEALOGY", "MES_ELECTRONIC_WORK_INSTRUCTIONS", "MES_PERFORMANCE",
  "CNC_MACHINE_CONNECT", "CNC_NC_PROGRAM_VERIFICATION", "CNC_DNC", "CNC_MACHINE_DATA",
  "TOOLING_TOOL_MANAGEMENT", "TOOLING_TOOL_LIFE", "TOOLING_PRESETTING",
  "FIXTURE_FIXTURE_MANAGEMENT", "FIXTURE_MAINTENANCE", "FIXTURE_CALIBRATION",
  "QMS_INSPECTION", "QMS_NCR_CAPA", "QMS_SPC_CALIBRATION", "QMS_ADVANCED_QUALITY",
  "CMMS_MAINTENANCE", "CMMS_RELIABILITY",
  "INVENTORY_INVENTORY_LEDGER", "INVENTORY_TRACEABILITY", "WMS_WAREHOUSE_EXECUTION",
  "PLM_PRODUCT_STRUCTURE", "PLM_NC_PROGRAM_CONTROL", "PLM_CHANGE_CONTROL",
  "MRP_MATERIAL_PLANNING", "MRP_PEGGING", "MRP_EXCEPTIONS",
  "MRP_II_CAPACITY_PLANNING", "MRP_II_RCCP", "MRP_II_CRP",
  "APS_FINITE_SCHEDULING", "APS_SCENARIO_PLANNING",
  "OEE_CORE", "OEE_ANDON",
  "ANALYTICS_REPORTING", "ANALYTICS_DASHBOARDS",
  "AI_COPILOT", "AI_GOVERNED_ACTIONS",
] as const;
export type ProductFeatureId = (typeof PRODUCT_FEATURE_IDS)[number];

export interface ProductFeatureDefinition {
  id: ProductFeatureId;
  productId: CommercialProductId;
  name: string;
  description: string;
}

export const PRODUCT_FEATURES: readonly ProductFeatureDefinition[] = [
  { id: "MES_EXECUTION", productId: "MES", name: "Execution", description: "Production and operation execution." },
  { id: "MES_OPERATOR_HMI", productId: "MES", name: "Operator HMI", description: "Guided operator execution terminal." },
  { id: "MES_GENEALOGY", productId: "MES", name: "Genealogy", description: "As-built and forward/backward genealogy." },
  { id: "MES_ELECTRONIC_WORK_INSTRUCTIONS", productId: "MES", name: "Electronic Work Instructions", description: "Controlled electronic execution instructions." },
  { id: "MES_PERFORMANCE", productId: "MES", name: "Performance", description: "Shop-floor performance metrics." },
  { id: "CNC_MACHINE_CONNECT", productId: "CNC", name: "Machine Connect", description: "Machine and controller connection." },
  { id: "CNC_NC_PROGRAM_VERIFICATION", productId: "CNC", name: "NC Program Verification", description: "Approved-program verification at execution." },
  { id: "CNC_DNC", productId: "CNC", name: "DNC", description: "NC distribution and collection." },
  { id: "CNC_MACHINE_DATA", productId: "CNC", name: "Machine Data", description: "Machine state and telemetry context." },
  { id: "TOOLING_TOOL_MANAGEMENT", productId: "TOOLING", name: "Tool Management", description: "Tool definitions, assemblies, and instances." },
  { id: "TOOLING_TOOL_LIFE", productId: "TOOLING", name: "Tool Life", description: "Tool-life measurement and adjustment." },
  { id: "TOOLING_PRESETTING", productId: "TOOLING", name: "Presetting", description: "Tool presetting and setup data." },
  { id: "FIXTURE_FIXTURE_MANAGEMENT", productId: "FIXTURE", name: "Fixture Management", description: "Fixture definitions, instances, and compatibility." },
  { id: "FIXTURE_MAINTENANCE", productId: "FIXTURE", name: "Maintenance", description: "Fixture maintenance policy and records." },
  { id: "FIXTURE_CALIBRATION", productId: "FIXTURE", name: "Calibration", description: "Fixture calibration policy and records." },
  { id: "QMS_INSPECTION", productId: "QMS", name: "Inspection", description: "Inspection and control-plan execution." },
  { id: "QMS_NCR_CAPA", productId: "QMS", name: "NCR / CAPA", description: "Nonconformance and corrective action." },
  { id: "QMS_SPC_CALIBRATION", productId: "QMS", name: "SPC / Calibration", description: "Statistical process control and quality calibration." },
  { id: "QMS_ADVANCED_QUALITY", productId: "QMS", name: "Advanced Quality", description: "Advanced quality workflows." },
  { id: "CMMS_MAINTENANCE", productId: "CMMS", name: "Maintenance", description: "Maintenance planning and execution." },
  { id: "CMMS_RELIABILITY", productId: "CMMS", name: "Reliability", description: "Reliability engineering and analysis." },
  { id: "INVENTORY_INVENTORY_LEDGER", productId: "INVENTORY", name: "Inventory Ledger", description: "Immutable inventory movements and balances." },
  { id: "INVENTORY_TRACEABILITY", productId: "INVENTORY", name: "Traceability", description: "Lot, serial, and traceability records." },
  { id: "WMS_WAREHOUSE_EXECUTION", productId: "WMS", name: "Warehouse Execution", description: "Warehouse task execution." },
  { id: "PLM_PRODUCT_STRUCTURE", productId: "PLM", name: "Product Structure", description: "BOM, routing, and released structure." },
  { id: "PLM_NC_PROGRAM_CONTROL", productId: "PLM", name: "NC Program Control", description: "NC program revision and release." },
  { id: "PLM_CHANGE_CONTROL", productId: "PLM", name: "Change Control", description: "Engineering change control." },
  { id: "MRP_MATERIAL_PLANNING", productId: "MRP", name: "Material Planning", description: "Material requirements planning." },
  { id: "MRP_PEGGING", productId: "MRP", name: "Pegging", description: "Demand-to-supply pegging." },
  { id: "MRP_EXCEPTIONS", productId: "MRP", name: "Exceptions", description: "Planning exception management." },
  { id: "MRP_II_CAPACITY_PLANNING", productId: "MRP_II", name: "Capacity Planning", description: "Capacity planning." },
  { id: "MRP_II_RCCP", productId: "MRP_II", name: "RCCP", description: "Rough-cut capacity planning." },
  { id: "MRP_II_CRP", productId: "MRP_II", name: "CRP", description: "Capacity requirements planning." },
  { id: "APS_FINITE_SCHEDULING", productId: "APS", name: "Finite Scheduling", description: "Finite-capacity scheduling." },
  { id: "APS_SCENARIO_PLANNING", productId: "APS", name: "Scenario Planning", description: "Planning scenario comparison." },
  { id: "OEE_CORE", productId: "OEE", name: "OEE Core", description: "Availability, performance, and quality metrics." },
  { id: "OEE_ANDON", productId: "OEE", name: "Andon", description: "Visual escalation and shop-floor signalling." },
  { id: "ANALYTICS_REPORTING", productId: "ANALYTICS", name: "Reporting", description: "Operational reporting and export." },
  { id: "ANALYTICS_DASHBOARDS", productId: "ANALYTICS", name: "Dashboards", description: "Operational dashboards." },
  { id: "AI_COPILOT", productId: "AI", name: "Copilot", description: "Permission-aware AI assistance." },
  { id: "AI_GOVERNED_ACTIONS", productId: "AI", name: "Governed Actions", description: "Approval- and policy-governed AI action proposals." },
];

export interface CommercialProductDefinition {
  id: CommercialProductId;
  commercialName: string;
  description: string;
  independentlySellable: true;
  status: ProductCommercialStatus;
  platformCapabilityRequirements: readonly PlatformCapabilityId[];
  providerRequirements: readonly ProductProviderRequirement[];
  /** Hard SKU dependencies. PRODUCT-ARCH-001 deliberately declares none. */
  commercialDependencies: readonly CommercialProductId[];
  /** Native AHK integrations that are useful but never required purchases. */
  nativeOptionalIntegrations: readonly CommercialProductId[];
  features: readonly ProductFeatureId[];
}

const shared = ["PLATFORM_CORE", "SHARED_MASTER_DATA"] as const;
const product = (definition: Omit<CommercialProductDefinition, "commercialDependencies">): CommercialProductDefinition => ({
  ...definition,
  commercialDependencies: [],
});

/**
 * Commercial graph: explicit empty hard-dependency lists plus optional native integrations.
 * Provider requirements above are deliberately not product IDs, so an external provider can satisfy them.
 */
export const COMMERCIAL_PRODUCTS: readonly CommercialProductDefinition[] = [
  product({ id: "CRM", commercialName: "AHK CRM", description: "Customer relationship management.", independentlySellable: true, status: "PARTIAL", platformCapabilityRequirements: shared, providerRequirements: [], nativeOptionalIntegrations: ["SALES", "SERVICE", "ANALYTICS"], features: [] }),
  product({ id: "SALES", commercialName: "AHK Sales", description: "Quote, order, and sales execution.", independentlySellable: true, status: "PARTIAL", platformCapabilityRequirements: shared, providerRequirements: [], nativeOptionalIntegrations: ["CRM", "INVENTORY", "FINANCE", "TMS"], features: [] }),
  product({ id: "PROCUREMENT", commercialName: "AHK Procurement", description: "Supplier and purchasing workflows.", independentlySellable: true, status: "PARTIAL", platformCapabilityRequirements: shared, providerRequirements: [], nativeOptionalIntegrations: ["INVENTORY", "MRP", "QMS", "FINANCE"], features: [] }),
  product({ id: "INVENTORY", commercialName: "AHK Inventory", description: "Inventory policy, ledger, and traceability.", independentlySellable: true, status: "PARTIAL", platformCapabilityRequirements: ["PLATFORM_CORE", "SHARED_MASTER_DATA", "PLATFORM_AUDIT"], providerRequirements: [], nativeOptionalIntegrations: ["WMS", "MRP", "MES", "QMS", "FINANCE"], features: ["INVENTORY_INVENTORY_LEDGER", "INVENTORY_TRACEABILITY"] }),
  product({ id: "WMS", commercialName: "AHK WMS", description: "Warehouse execution.", independentlySellable: true, status: "FOUNDATION", platformCapabilityRequirements: shared, providerRequirements: [{ requirementId: "INVENTORY_EXECUTION_PROVIDER", mode: "REQUIRED" }], nativeOptionalIntegrations: ["INVENTORY", "TMS", "ANALYTICS"], features: ["WMS_WAREHOUSE_EXECUTION"] }),
  product({ id: "MRP", commercialName: "AHK MRP", description: "Material requirements planning.", independentlySellable: true, status: "PARTIAL", platformCapabilityRequirements: shared, providerRequirements: [{ requirementId: "DEMAND_PROVIDER", mode: "REQUIRED" }, { requirementId: "BOM_PROVIDER", mode: "REQUIRED" }, { requirementId: "STOCK_PROVIDER", mode: "REQUIRED" }], nativeOptionalIntegrations: ["INVENTORY", "PLM", "SALES", "PROCUREMENT", "SCM"], features: ["MRP_MATERIAL_PLANNING", "MRP_PEGGING", "MRP_EXCEPTIONS"] }),
  product({ id: "MRP_II", commercialName: "AHK MRP II", description: "Capacity planning.", independentlySellable: true, status: "FOUNDATION", platformCapabilityRequirements: shared, providerRequirements: [{ requirementId: "RESOURCE_CONTEXT_PROVIDER", mode: "REQUIRED" }], nativeOptionalIntegrations: ["MRP", "MES", "CMMS"], features: ["MRP_II_CAPACITY_PLANNING", "MRP_II_RCCP", "MRP_II_CRP"] }),
  product({ id: "APS", commercialName: "AHK APS", description: "Finite scheduling and scenarios.", independentlySellable: true, status: "PARTIAL", platformCapabilityRequirements: shared, providerRequirements: [{ requirementId: "DEMAND_PROVIDER", mode: "REQUIRED" }, { requirementId: "RESOURCE_CONTEXT_PROVIDER", mode: "REQUIRED" }], nativeOptionalIntegrations: ["MRP", "MRP_II", "MES", "CMMS", "TOOLING", "FIXTURE"], features: ["APS_FINITE_SCHEDULING", "APS_SCENARIO_PLANNING"] }),
  product({ id: "MES", commercialName: "AHK MES", description: "Manufacturing execution.", independentlySellable: true, status: "PARTIAL", platformCapabilityRequirements: ["PLATFORM_CORE", "SHARED_MASTER_DATA", "PLATFORM_AUDIT", "PLATFORM_NOTIFICATION"], providerRequirements: [{ requirementId: "PROCESS_DEFINITION_PROVIDER", mode: "REQUIRED" }, { requirementId: "RESOURCE_CONTEXT_PROVIDER", mode: "REQUIRED" }, { requirementId: "INVENTORY_EXECUTION_PROVIDER", mode: "OPTIONAL" }, { requirementId: "NC_PROGRAM_PROVIDER", mode: "OPTIONAL" }, { requirementId: "MACHINE_DATA_PROVIDER", mode: "OPTIONAL" }], nativeOptionalIntegrations: ["PLM", "INVENTORY", "QMS", "MRP", "CNC", "TOOLING", "FIXTURE", "OEE"], features: ["MES_EXECUTION", "MES_OPERATOR_HMI", "MES_GENEALOGY", "MES_ELECTRONIC_WORK_INSTRUCTIONS", "MES_PERFORMANCE"] }),
  product({ id: "CNC", commercialName: "AHK CNC", description: "Machine, controller, and NC execution integration.", independentlySellable: true, status: "PARTIAL", platformCapabilityRequirements: ["PLATFORM_CORE", "SHARED_MASTER_DATA", "PLATFORM_INTEGRATION"], providerRequirements: [{ requirementId: "OPERATION_CONTEXT_PROVIDER", mode: "REQUIRED" }, { requirementId: "NC_PROGRAM_PROVIDER", mode: "OPTIONAL" }, { requirementId: "MACHINE_DATA_PROVIDER", mode: "OPTIONAL" }], nativeOptionalIntegrations: ["MES", "PLM", "OEE", "TOOLING", "FIXTURE"], features: ["CNC_MACHINE_CONNECT", "CNC_NC_PROGRAM_VERIFICATION", "CNC_DNC", "CNC_MACHINE_DATA"] }),
  product({ id: "TOOLING", commercialName: "AHK Tooling", description: "Tool, assembly, setup, and life management.", independentlySellable: true, status: "PARTIAL", platformCapabilityRequirements: ["PLATFORM_CORE", "SHARED_MASTER_DATA", "PLATFORM_AUDIT"], providerRequirements: [], nativeOptionalIntegrations: ["MES", "CNC", "CMMS", "COSTING"], features: ["TOOLING_TOOL_MANAGEMENT", "TOOLING_TOOL_LIFE", "TOOLING_PRESETTING"] }),
  product({ id: "FIXTURE", commercialName: "AHK Fixture", description: "Fixture lifecycle and suitability management.", independentlySellable: true, status: "PARTIAL", platformCapabilityRequirements: ["PLATFORM_CORE", "SHARED_MASTER_DATA", "PLATFORM_AUDIT"], providerRequirements: [], nativeOptionalIntegrations: ["MES", "CNC", "CMMS", "COSTING"], features: ["FIXTURE_FIXTURE_MANAGEMENT", "FIXTURE_MAINTENANCE", "FIXTURE_CALIBRATION"] }),
  product({ id: "QMS", commercialName: "AHK Quality", description: "Quality management.", independentlySellable: true, status: "PARTIAL", platformCapabilityRequirements: ["PLATFORM_CORE", "SHARED_MASTER_DATA", "PLATFORM_AUDIT", "PLATFORM_WORKFLOW"], providerRequirements: [], nativeOptionalIntegrations: ["MES", "INVENTORY", "PROCUREMENT", "CMMS", "ANALYTICS"], features: ["QMS_INSPECTION", "QMS_NCR_CAPA", "QMS_SPC_CALIBRATION", "QMS_ADVANCED_QUALITY"] }),
  product({ id: "CMMS", commercialName: "AHK CMMS", description: "Asset maintenance management.", independentlySellable: true, status: "PARTIAL", platformCapabilityRequirements: ["PLATFORM_CORE", "SHARED_MASTER_DATA", "PLATFORM_AUDIT"], providerRequirements: [], nativeOptionalIntegrations: ["MES", "CNC", "OEE", "INVENTORY", "PROCUREMENT"], features: ["CMMS_MAINTENANCE", "CMMS_RELIABILITY"] }),
  product({ id: "OEE", commercialName: "AHK Manufacturing Intelligence", description: "OEE, downtime, and Andon.", independentlySellable: true, status: "PARTIAL", platformCapabilityRequirements: ["PLATFORM_CORE", "SHARED_MASTER_DATA", "PLATFORM_INTEGRATION"], providerRequirements: [{ requirementId: "MACHINE_DATA_PROVIDER", mode: "OPTIONAL" }], nativeOptionalIntegrations: ["MES", "CNC", "CMMS", "ANALYTICS"], features: ["OEE_CORE", "OEE_ANDON"] }),
  product({ id: "PLM", commercialName: "AHK PLM", description: "Product lifecycle and engineering control.", independentlySellable: true, status: "PARTIAL", platformCapabilityRequirements: ["PLATFORM_CORE", "SHARED_MASTER_DATA", "PLATFORM_DOCUMENTS", "PLATFORM_WORKFLOW"], providerRequirements: [], nativeOptionalIntegrations: ["MES", "CNC", "MRP", "QMS"], features: ["PLM_PRODUCT_STRUCTURE", "PLM_NC_PROGRAM_CONTROL", "PLM_CHANGE_CONTROL"] }),
  product({ id: "COSTING", commercialName: "AHK Manufacturing Costing", description: "Manufacturing cost calculation.", independentlySellable: true, status: "PLANNED", platformCapabilityRequirements: ["PLATFORM_CORE", "SHARED_MASTER_DATA", "PLATFORM_AUDIT"], providerRequirements: [], nativeOptionalIntegrations: ["MES", "INVENTORY", "TOOLING", "FIXTURE", "CMMS", "FINANCE"], features: [] }),
  product({ id: "FINANCE", commercialName: "AHK Finance", description: "Financial operations.", independentlySellable: true, status: "PARTIAL", platformCapabilityRequirements: ["PLATFORM_CORE", "SHARED_MASTER_DATA", "PLATFORM_AUDIT"], providerRequirements: [], nativeOptionalIntegrations: ["SALES", "PROCUREMENT", "COSTING", "TMS"], features: [] }),
  product({ id: "HR", commercialName: "AHK HR", description: "Workforce and employee management.", independentlySellable: true, status: "PLANNED", platformCapabilityRequirements: ["PLATFORM_CORE", "SHARED_MASTER_DATA", "PLATFORM_DOCUMENTS"], providerRequirements: [], nativeOptionalIntegrations: ["MES", "CMMS", "PROJECT", "FINANCE"], features: [] }),
  product({ id: "PROJECT", commercialName: "AHK Project / ETO", description: "Project and engineer-to-order management.", independentlySellable: true, status: "PARTIAL", platformCapabilityRequirements: ["PLATFORM_CORE", "SHARED_MASTER_DATA", "PLATFORM_DOCUMENTS"], providerRequirements: [], nativeOptionalIntegrations: ["SALES", "MES", "PROCUREMENT", "INVENTORY", "COSTING", "QMS"], features: [] }),
  product({ id: "SERVICE", commercialName: "AHK Service", description: "Service and installed-base management.", independentlySellable: true, status: "PARTIAL", platformCapabilityRequirements: ["PLATFORM_CORE", "SHARED_MASTER_DATA", "PLATFORM_DOCUMENTS"], providerRequirements: [], nativeOptionalIntegrations: ["CRM", "INVENTORY", "PROCUREMENT", "FINANCE", "PROJECT"], features: [] }),
  product({ id: "SCM", commercialName: "AHK Demand Planning", description: "Demand planning and S&OP.", independentlySellable: true, status: "PLANNED", platformCapabilityRequirements: shared, providerRequirements: [{ requirementId: "DEMAND_PROVIDER", mode: "REQUIRED" }], nativeOptionalIntegrations: ["MRP", "PROCUREMENT", "SALES", "INVENTORY", "ANALYTICS"], features: [] }),
  product({ id: "TMS", commercialName: "AHK Transport", description: "Transport planning and execution.", independentlySellable: true, status: "PLANNED", platformCapabilityRequirements: shared, providerRequirements: [], nativeOptionalIntegrations: ["SALES", "WMS", "INVENTORY", "FINANCE"], features: [] }),
  product({ id: "ANALYTICS", commercialName: "AHK Analytics", description: "Reporting and analytics.", independentlySellable: true, status: "PARTIAL", platformCapabilityRequirements: shared, providerRequirements: [], nativeOptionalIntegrations: ["CRM", "SALES", "QMS", "OEE", "SCM", "AI"], features: ["ANALYTICS_REPORTING", "ANALYTICS_DASHBOARDS"] }),
  product({ id: "AI", commercialName: "AHK AI Copilot", description: "Governed AI assistance.", independentlySellable: true, status: "FOUNDATION", platformCapabilityRequirements: ["PLATFORM_CORE", "ENTITLEMENT_RUNTIME", "PLATFORM_AUDIT", "PLATFORM_WORKFLOW"], providerRequirements: [], nativeOptionalIntegrations: ["ANALYTICS", "MES", "QMS", "PLM"], features: ["AI_COPILOT", "AI_GOVERNED_ACTIONS"] }),
];

export type CommercialMappingDisposition = "DIRECT" | "SPLIT_REQUIRED";
export type CommercialMappingTarget =
  | { kind: "PLATFORM_CAPABILITY"; id: PlatformCapabilityId }
  | { kind: "PRODUCT_FEATURE"; productId: CommercialProductId; featureId?: ProductFeatureId };

export interface LegacyCommercialProductMapping {
  legacyCode: string;
  disposition: CommercialMappingDisposition;
  targets: readonly CommercialMappingTarget[];
  rationale: string;
}

const capability = (id: PlatformCapabilityId): CommercialMappingTarget => ({ kind: "PLATFORM_CAPABILITY", id });
const feature = (productId: CommercialProductId, featureId?: ProductFeatureId): CommercialMappingTarget => ({ kind: "PRODUCT_FEATURE", productId, featureId });

/**
 * Declarative projection only. It does not migrate tenants or alter current ProductModule behaviour.
 * SPLIT_REQUIRED entries must be resolved by PRODUCT-ARCH-002 migration policy, never inferred at runtime.
 */
export const LEGACY_COMMERCIAL_PRODUCT_MAPPING: readonly LegacyCommercialProductMapping[] = [
  { legacyCode: "PLATFORM_CORE", disposition: "DIRECT", targets: [capability("PLATFORM_CORE")], rationale: "Internal platform runtime remains non-sellable." },
  { legacyCode: "PLATFORM_IAM", disposition: "DIRECT", targets: [capability("PLATFORM_CORE")], rationale: "Identity/access is consolidated into Platform Core in the approved target taxonomy." },
  { legacyCode: "PLATFORM_AUTHORIZATION", disposition: "DIRECT", targets: [capability("PLATFORM_CORE")], rationale: "Authorization is consolidated into Platform Core in the approved target taxonomy." },
  { legacyCode: "PLATFORM_AUDIT", disposition: "DIRECT", targets: [capability("PLATFORM_AUDIT")], rationale: "Explicitly retained as a separate platform capability." },
  { legacyCode: "PLATFORM_DOCUMENTS", disposition: "DIRECT", targets: [capability("PLATFORM_DOCUMENTS")], rationale: "Platform document substrate." },
  { legacyCode: "PLATFORM_WORKFLOW", disposition: "DIRECT", targets: [capability("PLATFORM_WORKFLOW")], rationale: "Platform workflow substrate." },
  { legacyCode: "PLATFORM_INTEGRATION", disposition: "DIRECT", targets: [capability("PLATFORM_INTEGRATION")], rationale: "Platform integration substrate." },
  { legacyCode: "PLATFORM_OPERATIONS", disposition: "DIRECT", targets: [capability("PLATFORM_OPERATIONS")], rationale: "Platform operations substrate." },
  { legacyCode: "PLATFORM_AI", disposition: "DIRECT", targets: [feature("AI", "AI_COPILOT")], rationale: "The commercial AI product owns the Copilot feature; its platform dependencies remain internal." },
  { legacyCode: "ERP_MASTER_DATA", disposition: "DIRECT", targets: [capability("SHARED_MASTER_DATA")], rationale: "Canonical shared master data is a platform capability, not an ERP entitlement." },
  { legacyCode: "ERP_CRM_SALES", disposition: "SPLIT_REQUIRED", targets: [feature("CRM"), feature("SALES")], rationale: "One current technical module combines two independently sellable products." },
  { legacyCode: "ERP_PROCUREMENT", disposition: "DIRECT", targets: [feature("PROCUREMENT")], rationale: "Procurement becomes its own product." },
  { legacyCode: "ERP_FINANCE", disposition: "DIRECT", targets: [feature("FINANCE")], rationale: "Finance becomes its own product; current AR/AP scope does not imply full availability." },
  { legacyCode: "ERP_PROJECT_SERVICE", disposition: "SPLIT_REQUIRED", targets: [feature("PROJECT"), feature("SERVICE")], rationale: "One current technical module combines two independently sellable products." },
  { legacyCode: "WMS_INVENTORY_LEDGER", disposition: "DIRECT", targets: [feature("INVENTORY", "INVENTORY_INVENTORY_LEDGER")], rationale: "Inventory ledger belongs to Inventory, not warehouse execution." },
  { legacyCode: "WMS_TRACEABILITY", disposition: "DIRECT", targets: [feature("INVENTORY", "INVENTORY_TRACEABILITY")], rationale: "Traceability is an Inventory feature." },
  { legacyCode: "WMS_ADVANCED", disposition: "DIRECT", targets: [feature("WMS", "WMS_WAREHOUSE_EXECUTION")], rationale: "Warehouse execution remains a distinct target product." },
  { legacyCode: "PLM_PRODUCT_STRUCTURE", disposition: "DIRECT", targets: [feature("PLM", "PLM_PRODUCT_STRUCTURE")], rationale: "PLM product-structure feature." },
  { legacyCode: "PLM_CHANGE_CONTROL", disposition: "DIRECT", targets: [feature("PLM", "PLM_CHANGE_CONTROL")], rationale: "PLM change-control feature." },
  { legacyCode: "PLM_NC_PROGRAM", disposition: "DIRECT", targets: [feature("PLM", "PLM_NC_PROGRAM_CONTROL")], rationale: "PLM NC-program-control feature." },
  { legacyCode: "MES_EXECUTION", disposition: "DIRECT", targets: [feature("MES", "MES_EXECUTION")], rationale: "MES execution feature." },
  { legacyCode: "MES_GENEALOGY", disposition: "DIRECT", targets: [feature("MES", "MES_GENEALOGY")], rationale: "MES genealogy feature." },
  { legacyCode: "MES_OPERATOR_HMI", disposition: "DIRECT", targets: [feature("MES", "MES_OPERATOR_HMI")], rationale: "MES Operator HMI feature." },
  { legacyCode: "MES_PERFORMANCE", disposition: "SPLIT_REQUIRED", targets: [feature("MES", "MES_PERFORMANCE"), feature("OEE", "OEE_CORE")], rationale: "Current technical scope mixes MES performance with OEE ownership; migration policy must determine the tenant grant projection." },
  { legacyCode: "MES_CNC_TOOLING", disposition: "SPLIT_REQUIRED", targets: [feature("TOOLING", "TOOLING_TOOL_MANAGEMENT"), feature("TOOLING", "TOOLING_TOOL_LIFE"), feature("FIXTURE", "FIXTURE_FIXTURE_MANAGEMENT")], rationale: "Current tooling module owns both tool and fixture concerns; a future migration must not guess the commercial split." },
  { legacyCode: "MES_DNC", disposition: "DIRECT", targets: [feature("CNC", "CNC_DNC")], rationale: "DNC belongs to the CNC product." },
  { legacyCode: "QMS_INSPECTION", disposition: "DIRECT", targets: [feature("QMS", "QMS_INSPECTION")], rationale: "QMS inspection feature." },
  { legacyCode: "QMS_NCR_CAPA", disposition: "DIRECT", targets: [feature("QMS", "QMS_NCR_CAPA")], rationale: "QMS NCR/CAPA feature." },
  { legacyCode: "QMS_SPC_CALIBRATION", disposition: "DIRECT", targets: [feature("QMS", "QMS_SPC_CALIBRATION")], rationale: "QMS SPC/calibration feature." },
  { legacyCode: "QMS_ADVANCED", disposition: "DIRECT", targets: [feature("QMS", "QMS_ADVANCED_QUALITY")], rationale: "QMS advanced-quality feature." },
  { legacyCode: "EAM_MAINTENANCE", disposition: "DIRECT", targets: [feature("CMMS", "CMMS_MAINTENANCE")], rationale: "CMMS maintenance feature." },
  { legacyCode: "EAM_RELIABILITY", disposition: "DIRECT", targets: [feature("CMMS", "CMMS_RELIABILITY")], rationale: "CMMS reliability feature." },
  { legacyCode: "APS_MRP", disposition: "DIRECT", targets: [feature("MRP", "MRP_MATERIAL_PLANNING")], rationale: "MRP material-planning feature." },
  { legacyCode: "APS_SCHEDULING", disposition: "SPLIT_REQUIRED", targets: [feature("APS", "APS_FINITE_SCHEDULING"), feature("MRP_II", "MRP_II_CAPACITY_PLANNING")], rationale: "Current scheduling scope combines finite scheduling with capacity-model concerns; migration must not infer whether each tenant receives APS, MRP II, or both." },
  { legacyCode: "IIOT_MACHINE_CONNECT", disposition: "DIRECT", targets: [feature("CNC", "CNC_MACHINE_CONNECT")], rationale: "CNC owns the commercial machine-connect feature; the integration substrate remains platform-owned." },
  { legacyCode: "IIOT_HISTORIAN", disposition: "SPLIT_REQUIRED", targets: [feature("CNC", "CNC_MACHINE_DATA"), feature("ANALYTICS", "ANALYTICS_REPORTING")], rationale: "Historian and telemetry-quality scope can support both machine-data and analytics concerns; a migration must not infer a commercial grant from the planned technical record." },
  { legacyCode: "ANALYTICS_REPORTING", disposition: "DIRECT", targets: [feature("ANALYTICS", "ANALYTICS_REPORTING")], rationale: "Analytics reporting feature." },
  { legacyCode: "ANALYTICS_SEMANTIC_BI", disposition: "SPLIT_REQUIRED", targets: [feature("ANALYTICS", "ANALYTICS_REPORTING"), feature("ANALYTICS", "ANALYTICS_DASHBOARDS")], rationale: "The planned semantic-BI record combines data-mart, scheduled-report, KPI, and dashboard concerns; later delivery must decompose its feature grants explicitly." },
];
