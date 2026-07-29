import { z } from "zod";

export const RoleSchema = z.enum(["ADMIN", "SALES", "PLANNER", "FOREMAN", "OPERATOR"]);
export type Role = z.infer<typeof RoleSchema>;

export const QuoteStatusSchema = z.enum(["DRAFT", "SENT", "APPROVED", "REJECTED"]);
export type QuoteStatus = z.infer<typeof QuoteStatusSchema>;

export const WorkOrderStatusSchema = z.enum([
  "PLANNED",
  "WAITING_MATERIAL",
  "IN_PRODUCTION",
  "COMPLETED",
  "CANCELLED",
]);
export type WorkOrderStatus = z.infer<typeof WorkOrderStatusSchema>;

export const PurchaseOrderStatusSchema = z.enum(["ORDERED", "IN_TRANSIT", "RECEIVED", "CANCELLED"]);
export type PurchaseOrderStatus = z.infer<typeof PurchaseOrderStatusSchema>;

export const ProposalStatusSchema = z.enum([
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "CONVERTED",
]);
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;

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

export const DocumentEntityTypeSchema = z.enum(["part", "work-order"]);
export type DocumentEntityType = z.infer<typeof DocumentEntityTypeSchema>;

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

// ---- Non-Conformance (kalite modülü, v0.9) ----
export const NonConformanceStatusSchema = z.enum(["OPEN", "RESOLVED"]);
export type NonConformanceStatus = z.infer<typeof NonConformanceStatusSchema>;

export const NonConformanceActionTypeSchema = z.enum(["GENERIC", "SCRAP", "REWORK", "BLOCKING"]);
export type NonConformanceActionType = z.infer<typeof NonConformanceActionTypeSchema>;

export const UserAuthSourceSchema = z.enum(["LOCAL", "LDAP"]);
export type UserAuthSource = z.infer<typeof UserAuthSourceSchema>;

/// Rol gruplarının görünürlüğünü yönettiği NAV sayfaları — apps/web/src/components/layout.tsx
/// NAV listesiyle birebir eşleşir ("dashboard" hariç, o her zaman herkese görünür).
export const PAGE_KEYS = [
  "customers",
  "quotes",
  "work-orders",
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
  "users",
  "audit-log",
] as const;
export const PageKeySchema = z.enum(PAGE_KEYS);
export type PageKey = z.infer<typeof PageKeySchema>;
