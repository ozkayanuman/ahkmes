import { z } from "zod";
import {
  ConsumptionTypeSchema,
  DocumentEntityTypeSchema,
  DocumentTypeSchema,
  MachineConnectorTypeSchema,
  MachineEventTypeSchema,
  MachineTagDataTypeSchema,
  MaterialTypeSchema,
  NonConformanceActionTypeSchema,
  NonConformanceStatusSchema,
  PageKeySchema,
  PurchaseOrderStatusSchema,
  QuoteStatusSchema,
  RoleSchema,
  WorkOrderStatusSchema,
} from "./enums";

// ---- Ortak yardımcılar ----
export const idSchema = z.string().uuid();
const decimalString = z.union([z.number(), z.string()]).pipe(z.coerce.number());
export const positiveQty = decimalString.refine((n) => n > 0, "Miktar 0'dan büyük olmalı");
const isoDate = z.coerce.date();

// ---- Auth ----
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
export type LoginDto = z.infer<typeof loginSchema>;

// ---- User ----
export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  role: RoleSchema,
  isActive: z.boolean().default(true),
});
export const updateUserSchema = createUserSchema.partial().omit({ password: true }).extend({
  password: z.string().min(8).optional(),
});
export type CreateUserDto = z.infer<typeof createUserSchema>;
export type UpdateUserDto = z.infer<typeof updateUserSchema>;

// ---- Rol Grupları (sayfa görünürlüğü) ----
export const createPermissionGroupSchema = z.object({
  name: z.string().min(1),
  pages: z.array(PageKeySchema),
});
export const updatePermissionGroupSchema = createPermissionGroupSchema.partial();
export type CreatePermissionGroupDto = z.infer<typeof createPermissionGroupSchema>;
export type UpdatePermissionGroupDto = z.infer<typeof updatePermissionGroupSchema>;

export const assignGroupMemberSchema = z.object({ userId: idSchema });
export type AssignGroupMemberDto = z.infer<typeof assignGroupMemberSchema>;

// ---- Active Directory / LDAP ----
export const ldapConfigSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535).default(389),
  useTls: z.boolean().default(false),
  bindDn: z.string().min(1),
  bindPassword: z.string().min(1),
  baseDn: z.string().min(1),
  userFilter: z.string().min(1).default("(objectClass=person)"),
  attrEmail: z.string().min(1).default("mail"),
  attrName: z.string().min(1).default("displayName"),
  defaultRole: RoleSchema.default("OPERATOR"),
});
export type LdapConfigDto = z.infer<typeof ldapConfigSchema>;

// ---- Customer ----
export const createCustomerSchema = z.object({
  name: z.string().min(1),
  contactName: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  address: z.string().optional(),
  taxNo: z.string().optional(),
  notes: z.string().optional(),
});
export const updateCustomerSchema = createCustomerSchema.partial();
export type CreateCustomerDto = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerDto = z.infer<typeof updateCustomerSchema>;

// ---- Part ----
export const createPartSchema = z.object({
  partNo: z.string().min(1),
  revision: z.string().min(1).default("A"),
  name: z.string().min(1),
  description: z.string().optional(),
  drawingFileRef: z.string().optional(),
  stepFileRef: z.string().optional(),
  idealCycleTimeSec: decimalString.optional(),
});
export const updatePartSchema = createPartSchema.partial();
export type CreatePartDto = z.infer<typeof createPartSchema>;
export type UpdatePartDto = z.infer<typeof updatePartSchema>;

// ---- NcProgram ----
export const createNcProgramSchema = z.object({
  partId: idSchema,
  fileName: z.string().min(1),
  fileRef: z.string().min(1),
  notes: z.string().optional(),
});
export type CreateNcProgramDto = z.infer<typeof createNcProgramSchema>;

// ---- Supplier ----
export const createSupplierSchema = z.object({
  name: z.string().min(1),
  contactName: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  address: z.string().optional(),
  taxNo: z.string().optional(),
  notes: z.string().optional(),
});
export const updateSupplierSchema = createSupplierSchema.partial();
export type CreateSupplierDto = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierDto = z.infer<typeof updateSupplierSchema>;

// ---- Material ----
export const createMaterialSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  type: MaterialTypeSchema,
  unit: z.string().min(1),
  minStock: decimalString.optional(),
});
export const updateMaterialSchema = createMaterialSchema.partial();
export type CreateMaterialDto = z.infer<typeof createMaterialSchema>;
export type UpdateMaterialDto = z.infer<typeof updateMaterialSchema>;

// ---- Machine (sadece referans) ----
export const createMachineSchema = z.object({
  name: z.string().min(1),
  model: z.string().min(1),
  controller: z.string().optional(),
  isActive: z.boolean().default(true),
  connectorType: MachineConnectorTypeSchema.default("MANUAL"),
  connectorConfig: z.record(z.unknown()).optional(),
  /// Saha hiyerarşisindeki yeri — null: yerleştirilmemiş/kaldırılmış.
  unitId: idSchema.nullable().optional(),
});
export const updateMachineSchema = createMachineSchema.partial();
export type CreateMachineDto = z.infer<typeof createMachineSchema>;
export type UpdateMachineDto = z.infer<typeof updateMachineSchema>;

// ---- Saha hiyerarşisi (Plant > Area > Workplace > Unit) ----
export const createPlantSchema = z.object({
  name: z.string().min(1),
  code: z.string().optional(),
  location: z.string().optional(),
});
export const updatePlantSchema = createPlantSchema.partial();
export type CreatePlantDto = z.infer<typeof createPlantSchema>;
export type UpdatePlantDto = z.infer<typeof updatePlantSchema>;

export const createAreaSchema = z.object({ plantId: idSchema, name: z.string().min(1) });
export const updateAreaSchema = z.object({ name: z.string().min(1) });
export type CreateAreaDto = z.infer<typeof createAreaSchema>;
export type UpdateAreaDto = z.infer<typeof updateAreaSchema>;

export const createWorkplaceSchema = z.object({ areaId: idSchema, name: z.string().min(1) });
export const updateWorkplaceSchema = z.object({ name: z.string().min(1) });
export type CreateWorkplaceDto = z.infer<typeof createWorkplaceSchema>;
export type UpdateWorkplaceDto = z.infer<typeof updateWorkplaceSchema>;

export const createUnitSchema = z.object({ workplaceId: idSchema, name: z.string().min(1) });
export const updateUnitSchema = z.object({ name: z.string().min(1) });
export type CreateUnitDto = z.infer<typeof createUnitSchema>;
export type UpdateUnitDto = z.infer<typeof updateUnitSchema>;

// ---- Digital Twin (2D saha planı — hiyerarşiden bağımsız fiziksel konum) ----
export const updateMachinePositionSchema = z.object({ posX: z.number(), posY: z.number() });
export type UpdateMachinePositionDto = z.infer<typeof updateMachinePositionSchema>;

export const createMachineConnectionSchema = z.object({ fromMachineId: idSchema, toMachineId: idSchema });
export type CreateMachineConnectionDto = z.infer<typeof createMachineConnectionSchema>;

// ---- Quote (Faz 0b'de kullanılacak) ----
export const quoteLineInputSchema = z.object({
  partId: idSchema,
  quantity: positiveQty,
  unitPrice: decimalString,
  dueDate: isoDate,
});
export const createQuoteSchema = z.object({
  customerId: idSchema,
  currency: z.string().default("TRY"),
  validUntil: isoDate.optional(),
  notes: z.string().optional(),
  lines: z.array(quoteLineInputSchema).min(1),
});
export const quoteStatusUpdateSchema = z.object({ status: QuoteStatusSchema });
export const updateQuoteSchema = createQuoteSchema.omit({ lines: true }).partial();
export const updateQuoteLineSchema = quoteLineInputSchema.partial();
export const convertQuoteSchema = z.object({ lineIds: z.array(idSchema).optional() });
export type CreateQuoteDto = z.infer<typeof createQuoteSchema>;
export type UpdateQuoteDto = z.infer<typeof updateQuoteSchema>;
export type QuoteLineInputDto = z.infer<typeof quoteLineInputSchema>;
export type UpdateQuoteLineDto = z.infer<typeof updateQuoteLineSchema>;
export type ConvertQuoteDto = z.infer<typeof convertQuoteSchema>;
export type QuoteStatusUpdateDto = z.infer<typeof quoteStatusUpdateSchema>;

// ---- WorkOrder (Faz 0b) ----
export const createWorkOrderSchema = z.object({
  quoteLineId: idSchema.optional(),
  partId: idSchema,
  quantity: positiveQty,
  dueDate: isoDate,
  priority: z.number().int().min(1).max(10).default(5),
  machineId: idSchema.optional(),
  notes: z.string().optional(),
});
export const workOrderStatusUpdateSchema = z.object({ status: WorkOrderStatusSchema });
export const updateWorkOrderSchema = createWorkOrderSchema.omit({ quoteLineId: true }).partial();
export type CreateWorkOrderDto = z.infer<typeof createWorkOrderSchema>;
export type UpdateWorkOrderDto = z.infer<typeof updateWorkOrderSchema>;
export type WorkOrderStatusUpdateDto = z.infer<typeof workOrderStatusUpdateSchema>;

// ---- PurchaseOrder (Faz 0b) ----
export const purchaseOrderLineInputSchema = z.object({
  materialId: idSchema,
  quantity: positiveQty,
  unitPrice: decimalString,
});
export const createPurchaseOrderSchema = z.object({
  supplierId: idSchema,
  orderDate: isoDate,
  expectedDate: isoDate.optional(),
  notes: z.string().optional(),
  lines: z.array(purchaseOrderLineInputSchema).min(1),
});
export const receivePurchaseOrderSchema = z.object({
  lines: z.array(z.object({ lineId: idSchema, receivedQty: positiveQty })).min(1),
});
export const purchaseOrderStatusUpdateSchema = z.object({ status: PurchaseOrderStatusSchema });
export const updatePurchaseOrderSchema = z.object({
  expectedDate: isoDate.optional(),
  notes: z.string().optional(),
});
export type CreatePurchaseOrderDto = z.infer<typeof createPurchaseOrderSchema>;
export type UpdatePurchaseOrderDto = z.infer<typeof updatePurchaseOrderSchema>;
export type ReceivePurchaseOrderDto = z.infer<typeof receivePurchaseOrderSchema>;
export type PurchaseOrderStatusUpdateDto = z.infer<typeof purchaseOrderStatusUpdateSchema>;

// ---- MaterialConsumption (Faz 0c) ----
export const createConsumptionSchema = z.object({
  workOrderId: idSchema,
  materialId: idSchema,
  type: ConsumptionTypeSchema,
  quantity: positiveQty,
  date: isoDate.optional(),
});
export type CreateConsumptionDto = z.infer<typeof createConsumptionSchema>;

// ---- ProductionRun (Faz 0c) — source her zaman MANUAL, API girişinde alınmaz ----
export const startProductionRunSchema = z.object({
  machineId: idSchema.optional(),
  notes: z.string().optional(),
});
export const updateProductionRunSchema = z.object({
  goodCount: z.number().int().min(0).optional(),
  scrapCount: z.number().int().min(0).optional(),
  downtimeNote: z.string().optional(),
  notes: z.string().optional(),
  /** Sadece POST /runs/:id/complete'de kullanılır — true ise iş emri de COMPLETED'a çekilir (operatör ekranı "Tamamla" sekmesi). */
  completeWorkOrder: z.boolean().optional(),
});
export type StartProductionRunDto = z.infer<typeof startProductionRunSchema>;

// ---- FinishedGoodsEntry (Faz 0c) ----
export const createFinishedGoodsSchema = z.object({
  workOrderId: idSchema,
  quantity: positiveQty,
  date: isoDate.optional(),
});
export type CreateFinishedGoodsDto = z.infer<typeof createFinishedGoodsSchema>;

// ---- Document (STEP / Work Instruction dosya deposu) ----
export const uploadDocumentMetaSchema = z.object({
  entityType: DocumentEntityTypeSchema,
  entityId: idSchema,
  docType: DocumentTypeSchema,
});
export type UploadDocumentMetaDto = z.infer<typeof uploadDocumentMetaSchema>;

// ---- Machine Connector (Faz 1) ----
export const machineTelemetrySchema = z.object({
  type: MachineEventTypeSchema,
  timestamp: isoDate.optional(),
  payload: z.record(z.unknown()).optional(),
  /** İdempotency: connector'ın retry'de aynı olayı tekrar göndermesi durumunda
   * ikinci işlemeyi engellemek için — verilmezse dedup uygulanmaz (geriye uyumlu). */
  eventId: z.string().min(1).optional(),
});
export type MachineTelemetryDto = z.infer<typeof machineTelemetrySchema>;

export const assignActiveWorkOrderSchema = z.object({
  workOrderId: idSchema.nullable(),
});
export type AssignActiveWorkOrderDto = z.infer<typeof assignActiveWorkOrderSchema>;

// ---- Automation Gateway (Machine Tag — Faz 1) ----
export const createMachineTagSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  dataType: MachineTagDataTypeSchema.default("STRING"),
});
export const updateMachineTagSchema = createMachineTagSchema.partial();
export type CreateMachineTagDto = z.infer<typeof createMachineTagSchema>;
export type UpdateMachineTagDto = z.infer<typeof updateMachineTagSchema>;

export const tagValueSchema = z.object({
  tagName: z.string().min(1),
  value: z.string(),
  timestamp: isoDate.optional(),
});
export const machineTagValuesSchema = z.object({
  values: z.array(tagValueSchema).min(1),
});
export type MachineTagValuesDto = z.infer<typeof machineTagValuesSchema>;

// ---- Scheduling (basit Gantt, v1.0) ----
export const scheduleWorkOrderSchema = z.object({
  plannedStartDate: isoDate.nullable(),
  plannedEndDate: isoDate.nullable(),
});
export type ScheduleWorkOrderDto = z.infer<typeof scheduleWorkOrderSchema>;

// ---- Non-Conformance (kalite modülü, v0.9) ----
export const createNonConformanceSchema = z.object({
  workOrderId: idSchema,
  productionRunId: idSchema.optional(),
  failureType: z.string().min(1),
  description: z.string().optional(),
  actionType: NonConformanceActionTypeSchema.default("GENERIC"),
});
export type CreateNonConformanceDto = z.infer<typeof createNonConformanceSchema>;

export const resolveNonConformanceSchema = z.object({
  status: NonConformanceStatusSchema,
  /// Sadece status=RESOLVED iken zorunlu — kapatma tek tıkla değil, ne yapıldığının
  /// (hurda/yeniden işlem/kabul vb.) yazılı gerekçesiyle olmalı.
  resolutionNote: z.string().min(1).optional(),
});
export type ResolveNonConformanceDto = z.infer<typeof resolveNonConformanceSchema>;
