import { z } from "zod";

export const RoleSchema = z.enum(["ADMIN", "SALES", "PLANNER", "FOREMAN", "OPERATOR"]);
export type Role = z.infer<typeof RoleSchema>;

export const QuoteStatusSchema = z.enum(["DRAFT", "SENT", "APPROVED", "REJECTED"]);
export type QuoteStatus = z.infer<typeof QuoteStatusSchema>;

export const WorkOrderStatusSchema = z.enum([
  "PLANNED",
  "RELEASED",
  "WAITING_MATERIAL",
  "IN_PRODUCTION",
  "COMPLETED",
  "CANCELLED",
]);
export type WorkOrderStatus = z.infer<typeof WorkOrderStatusSchema>;

export const EngineeringStatusSchema = z.enum(["DRAFT", "RELEASED", "OBSOLETE", "LEGACY_UNVERIFIED"]);
export type EngineeringStatus = z.infer<typeof EngineeringStatusSchema>;

export const UomDimensionSchema = z.enum(["COUNT", "MASS", "LENGTH", "AREA", "VOLUME", "TIME"]);
export type UomDimension = z.infer<typeof UomDimensionSchema>;

export const WorkOrderOperationStatusSchema = z.enum([
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "BLOCKED",
  "SKIPPED",
]);
export type WorkOrderOperationStatus = z.infer<typeof WorkOrderOperationStatusSchema>;

export const PurchaseOrderStatusSchema = z.enum(["ORDERED", "IN_TRANSIT", "RECEIVED", "CANCELLED"]);
export type PurchaseOrderStatus = z.infer<typeof PurchaseOrderStatusSchema>;

export const RFQStatusSchema = z.enum(["DRAFT", "SENT", "CONVERTED", "CLOSED"]);
export type RFQStatus = z.infer<typeof RFQStatusSchema>;

export const SalesOrderStatusSchema = z.enum(["OPEN", "CLOSED", "CANCELLED"]);
export type SalesOrderStatus = z.infer<typeof SalesOrderStatusSchema>;

export const InvoiceStatusSchema = z.enum(["ISSUED", "CANCELLED"]);
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;

export const StockItemTypeSchema = z.enum(["MATERIAL", "PART"]);
export type StockItemType = z.infer<typeof StockItemTypeSchema>;

export const LotAcceptanceStatusSchema = z.enum(["PENDING", "ACCEPTED", "QUARANTINED", "REJECTED"]);
export type LotAcceptanceStatus = z.infer<typeof LotAcceptanceStatusSchema>;

export const ProjectStatusSchema = z.enum(["PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectTaskStatusSchema = z.enum(["TODO", "IN_PROGRESS", "DONE"]);
export type ProjectTaskStatus = z.infer<typeof ProjectTaskStatusSchema>;

export const LeadStatusSchema = z.enum(["NEW", "QUALIFIED", "DISQUALIFIED", "CONVERTED"]);
export type LeadStatus = z.infer<typeof LeadStatusSchema>;

export const OpportunityStageSchema = z.enum(["NEW", "QUALIFIED", "PROPOSAL", "WON", "LOST"]);
export type OpportunityStage = z.infer<typeof OpportunityStageSchema>;

export const ServiceTicketPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type ServiceTicketPriority = z.infer<typeof ServiceTicketPrioritySchema>;

export const ServiceTicketStatusSchema = z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]);
export type ServiceTicketStatus = z.infer<typeof ServiceTicketStatusSchema>;

export const TransferOrderStatusSchema = z.enum(["COMPLETED", "CANCELLED"]);
export type TransferOrderStatus = z.infer<typeof TransferOrderStatusSchema>;

export const CycleCountStatusSchema = z.enum(["OPEN", "POSTED"]);
export type CycleCountStatus = z.infer<typeof CycleCountStatusSchema>;

export const InspectionResultSchema = z.enum(["PASS", "FAIL"]);
export type InspectionResult = z.infer<typeof InspectionResultSchema>;
export const QualityCharacteristicTypeSchema = z.enum(["NUMERIC", "BOOLEAN", "QUALITATIVE"]);
export const QualitySamplingMethodSchema = z.enum(["HUNDRED_PERCENT", "FIXED_COUNT"]);
export const InspectionPointSchema = z.enum(["INCOMING", "IN_PROCESS", "FINAL"]);
export const QualityDispositionTypeSchema = z.enum(["ACCEPT", "USE_AS_IS", "REWORK", "SCRAP"]);

export const CapaStatusSchema = z.enum(["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "CLOSED"]);
export type CapaStatus = z.infer<typeof CapaStatusSchema>;

export const MaintenanceOrderTypeSchema = z.enum(["PREVENTIVE", "CORRECTIVE"]);
export type MaintenanceOrderType = z.infer<typeof MaintenanceOrderTypeSchema>;

export const MaintenanceOrderStatusSchema = z.enum(["DRAFT", "PLANNED", "RELEASED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"]);
export type MaintenanceOrderStatus = z.infer<typeof MaintenanceOrderStatusSchema>;
export const MaintenancePrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const MachineMaintenanceStateSchema = z.enum(["AVAILABLE", "MAINTENANCE_DUE", "PLANNED_MAINTENANCE", "BREAKDOWN", "OUT_OF_SERVICE"]);
export const MaintenanceCodeKindSchema = z.enum(["FAILURE", "CAUSE", "REMEDY"]);

export const ProposalStatusSchema = z.enum([
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "CONVERTED",
]);
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;

// ---- CNC-V1-03R daily MRP ----
export const MrpPlanningPolicySchema = z.enum(["MAKE", "BUY", "MAKE_OR_BUY"]);
export type MrpPlanningPolicy = z.infer<typeof MrpPlanningPolicySchema>;
export const MrpLotSizingRuleSchema = z.enum(["LOT_FOR_LOT", "MINIMUM_QUANTITY", "ORDER_MULTIPLE", "FIXED_LOT_SIZE"]);
export type MrpLotSizingRule = z.infer<typeof MrpLotSizingRuleSchema>;
export const MrpProposalStatusSchema = z.enum(["PROPOSED", "FIRMED", "CONVERTED", "CANCELLED", "SUPERSEDED"]);
export type MrpProposalStatus = z.infer<typeof MrpProposalStatusSchema>;
export const MrpExceptionTypeSchema = z.enum(["SHORTAGE", "RESCHEDULE_IN", "RESCHEDULE_OUT", "CANCEL", "QUANTITY_EXCESS", "QUANTITY_SHORTAGE", "MISSING_POLICY"]);
export type MrpExceptionType = z.infer<typeof MrpExceptionTypeSchema>;
export const MrpExceptionSeveritySchema = z.enum(["CRITICAL", "WARNING", "INFO"]);
export type MrpExceptionSeverity = z.infer<typeof MrpExceptionSeveritySchema>;

export const MaterialTypeSchema = z.enum(["RAW", "CONSUMABLE"]);
export type MaterialType = z.infer<typeof MaterialTypeSchema>;

export const ConsumptionTypeSchema = z.enum(["RESERVED", "CONSUMED"]);
export type ConsumptionType = z.infer<typeof ConsumptionTypeSchema>;

export const RunSourceSchema = z.enum(["MANUAL", "MACHINE"]);
export type RunSource = z.infer<typeof RunSourceSchema>;

export const AuditActionSchema = z.enum(["CREATE", "UPDATE", "DELETE", "STATUS_CHANGE"]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

export const DocumentTypeSchema = z.enum(["STEP", "WORK_INSTRUCTION", "OTHER"]);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

export const DocumentEntityTypeSchema = z.enum(["part", "work-order", "calibration", "lot", "recipe-step", "machine", "maintenance-request", "maintenance-breakdown", "maintenance-order"]);
export type DocumentEntityType = z.infer<typeof DocumentEntityTypeSchema>;

export const NcProgramStatusSchema = z.enum(["DRAFT", "REVIEW", "APPROVED", "PUBLISHED", "SUPERSEDED", "ARCHIVED"]);
export type NcProgramStatus = z.infer<typeof NcProgramStatusSchema>;

export const MachineEventTypeSchema = z.enum([
  "CYCLE_START",
  "CYCLE_END",
  "PART_COMPLETE",
  "ALARM",
  "IDLE",
]);
export type MachineEventType = z.infer<typeof MachineEventTypeSchema>;

// ---- Automation Gateway (tag izleme, Faz 1+) ----
export const MachineTagDataTypeSchema = z.enum(["NUMBER", "STRING", "BOOLEAN"]);
export type MachineTagDataType = z.infer<typeof MachineTagDataTypeSchema>;

export const MachineConnectorTypeSchema = z.enum(["MANUAL", "OPC_UA", "M80"]);
export type MachineConnectorType = z.infer<typeof MachineConnectorTypeSchema>;

// ---- CNC-V1-05 controller qualification ----
export const ControllerCapabilitySchema = z.enum([
  "CONNECTIVITY",
  "MACHINE_STATE_READ",
  "ACTIVE_PROGRAM_IDENTITY_READ",
  "PROGRAM_CONTENT_READ",
  "PROGRAM_CHECKSUM_READ",
  "CYCLE_STATE_READ",
  "ALARM_READ",
  "FEED_OVERRIDE_READ",
  "SPINDLE_STATE_READ",
  "PART_COUNTER_READ",
  "PROGRAM_TRANSFER",
  "REMOTE_START",
]);
export type ControllerCapability = z.infer<typeof ControllerCapabilitySchema>;

export const ControllerObservationTrustSchema = z.enum(["SIMULATED", "CONFIGURED", "OBSERVED", "CONTROLLER_VERIFIED"]);
export type ControllerObservationTrust = z.infer<typeof ControllerObservationTrustSchema>;
export const ControllerConnectionStateSchema = z.enum(["UNKNOWN", "CONNECTING", "ONLINE", "DEGRADED", "OFFLINE"]);
export type ControllerConnectionState = z.infer<typeof ControllerConnectionStateSchema>;
export const ControllerMachineStateSchema = z.enum(["UNKNOWN", "IDLE", "READY", "RUNNING", "FEED_HOLD", "ALARM", "STOPPED", "OFFLINE"]);
export type ControllerMachineState = z.infer<typeof ControllerMachineStateSchema>;
export const ControllerProgramVerificationSchema = z.enum(["MATCH", "MISMATCH", "UNVERIFIED", "STALE", "UNSUPPORTED"]);
export type ControllerProgramVerification = z.infer<typeof ControllerProgramVerificationSchema>;

// ---- Non-Conformance (kalite modülü, v0.9) ----
export const NonConformanceStatusSchema = z.enum(["OPEN", "RESOLVED", "PENDING_DEVIATION_APPROVAL"]);
export type NonConformanceStatus = z.infer<typeof NonConformanceStatusSchema>;

export const NonConformanceActionTypeSchema = z.enum(["GENERIC", "SCRAP", "REWORK", "BLOCKING", "DEVIATION"]);
export type NonConformanceActionType = z.infer<typeof NonConformanceActionTypeSchema>;

export const UserAuthSourceSchema = z.enum(["LOCAL", "LDAP", "OIDC"]);
export type UserAuthSource = z.infer<typeof UserAuthSourceSchema>;

// ---- Alarm Management (Faz F) ----
export const AlarmSeveritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type AlarmSeverity = z.infer<typeof AlarmSeveritySchema>;

export const DowntimeReasonCategorySchema = z.enum(["PLANNED", "UNPLANNED"]);
export type DowntimeReasonCategory = z.infer<typeof DowntimeReasonCategorySchema>;
export const ProductionLossCategorySchema = z.enum([
  "PLANNED_MAINTENANCE",
  "UNPLANNED_BREAKDOWN",
  "QUALITY_HOLD",
  "MATERIAL_SHORTAGE",
  "SETUP_CHANGEOVER",
  "OPERATOR_RESOURCE_PAUSE",
  "OTHER_PLANNED",
  "OTHER_UNPLANNED",
]);
export type ProductionLossCategory = z.infer<typeof ProductionLossCategorySchema>;
export const DowntimeEventSourceSchema = z.enum(["ALARM", "MANUAL"]);
export type DowntimeEventSource = z.infer<typeof DowntimeEventSourceSchema>;

/** Ticari paketleme sınırı; kullanıcı sayfa yetkisinden bağımsızdır. */
export const PRODUCT_MODULES = [
  "PLATFORM_DOCUMENTS", "PLATFORM_WORKFLOW", "PLATFORM_INTEGRATION", "PLATFORM_OPERATIONS", "PLATFORM_AI",
  "ERP_MASTER_DATA", "ERP_CRM_SALES", "ERP_PROCUREMENT", "ERP_FINANCE", "ERP_PROJECT_SERVICE",
  "WMS_INVENTORY_LEDGER", "WMS_TRACEABILITY",
  "PLM_PRODUCT_STRUCTURE", "PLM_NC_PROGRAM",
  "MES_EXECUTION", "MES_CNC_TOOLING", "MES_GENEALOGY", "MES_PERFORMANCE",
  "QMS_INSPECTION", "QMS_NCR_CAPA", "QMS_SPC_CALIBRATION",
  "EAM_MAINTENANCE",
  "APS_MRP", "APS_SCHEDULING",
  "IIOT_MACHINE_CONNECT",
  "ANALYTICS_REPORTING",
] as const;
export const ProductModuleSchema = z.enum(PRODUCT_MODULES);
export type ProductModule = z.infer<typeof ProductModuleSchema>;

/// Rol gruplarının görünürlüğünü yönettiği NAV sayfaları — apps/web/src/components/layout.tsx
/// NAV listesiyle birebir eşleşir ("dashboard" hariç, o her zaman herkese görünür).
export const PAGE_KEYS = [
  "customers",
  "leads",
  "service-tickets",
  "rfq",
  "quotes",
  "sales-orders",
  "work-orders",
  "warehouses",
  "lots",
  "serial-numbers",
  "transfer-orders",
  "projects",
  "cycle-counts",
  "inspections",
  "capa",
  "calibrations",
  "maintenance-orders",
  "energy",
  "recipes",
  "spc",
  "alarms",
  "ar",
  "ap",
  "purchase-orders",
  "production",
  "parts",
  "suppliers",
  "materials",
  "machines",
  "hierarchy",
  "digital-twin",
  "automation-gateway",
  "non-conformances",
  "genealogy",
  "scheduling",
  "mrp",
  "shift-report",
  "labor",
  "users",
  "audit-log",
  "platform-modules",
  "webhooks",
  "reports",
  "copilot",
  "tooling",
  "hmi-operations",
] as const;
export const PageKeySchema = z.enum(PAGE_KEYS);
export type PageKey = z.infer<typeof PageKeySchema>;

/**
 * A disabled product module must be enforced by the backend; this shared map
 * lets the SPA provide the same clear navigation feedback without duplicating
 * commercial-boundary decisions in each screen.
 */
export const PAGE_PRODUCT_MODULE: Record<PageKey, ProductModule | "PLATFORM_CORE"> = {
  customers: "ERP_MASTER_DATA", leads: "ERP_CRM_SALES", "service-tickets": "ERP_PROJECT_SERVICE",
  rfq: "ERP_PROCUREMENT", quotes: "ERP_CRM_SALES", "sales-orders": "ERP_CRM_SALES",
  "purchase-orders": "ERP_PROCUREMENT", ar: "ERP_FINANCE", ap: "ERP_FINANCE",
  projects: "ERP_PROJECT_SERVICE", labor: "MES_EXECUTION",
  users: "PLATFORM_CORE", "audit-log": "PLATFORM_CORE", "platform-modules": "PLATFORM_CORE",
  materials: "ERP_MASTER_DATA", parts: "ERP_MASTER_DATA", suppliers: "ERP_MASTER_DATA", hierarchy: "PLATFORM_CORE",
  "work-orders": "MES_EXECUTION", production: "MES_EXECUTION", "hmi-operations": "MES_EXECUTION", recipes: "PLM_PRODUCT_STRUCTURE", genealogy: "MES_GENEALOGY", "shift-report": "MES_EXECUTION",
  warehouses: "WMS_INVENTORY_LEDGER", lots: "WMS_TRACEABILITY", "serial-numbers": "WMS_TRACEABILITY", "transfer-orders": "WMS_INVENTORY_LEDGER", "cycle-counts": "WMS_INVENTORY_LEDGER",
  mrp: "APS_MRP", scheduling: "APS_SCHEDULING",
  inspections: "QMS_INSPECTION", capa: "QMS_NCR_CAPA", calibrations: "QMS_SPC_CALIBRATION", spc: "QMS_SPC_CALIBRATION", alarms: "QMS_INSPECTION", "non-conformances": "QMS_NCR_CAPA",
  "maintenance-orders": "EAM_MAINTENANCE", energy: "EAM_MAINTENANCE",
  machines: "IIOT_MACHINE_CONNECT", "automation-gateway": "IIOT_MACHINE_CONNECT", "digital-twin": "IIOT_MACHINE_CONNECT",
  webhooks: "PLATFORM_INTEGRATION", reports: "ANALYTICS_REPORTING", copilot: "PLATFORM_AI",
  tooling: "MES_CNC_TOOLING",
};
