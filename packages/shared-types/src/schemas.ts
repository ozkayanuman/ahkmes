import { z } from "zod";
import {
  AlarmSeveritySchema,
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
  InspectionResultSchema,
  InvoiceStatusSchema,
  LeadStatusSchema,
  LotAcceptanceStatusSchema,
  MaintenanceOrderTypeSchema,
  OpportunityStageSchema,
  ProjectStatusSchema,
  ProjectTaskStatusSchema,
  PurchaseOrderStatusSchema,
  QuoteStatusSchema,
  RFQStatusSchema,
  RoleSchema,
  SalesOrderStatusSchema,
  ServiceTicketPrioritySchema,
  ServiceTicketStatusSchema,
  StockItemTypeSchema,
  WorkOrderOperationStatusSchema,
  WorkOrderStatusSchema,
} from "./enums";

// ---- Ortak yardımcılar ----
export const idSchema = z.string().uuid();
const decimalString = z.union([z.number(), z.string()]).pipe(z.coerce.number());
export const positiveQty = decimalString.refine((n) => n > 0, "Miktar 0'dan büyük olmalı");
const isoDate = z.coerce.date();

// ---- MES-TOOL-001 CNC tooling / fixture ----
const toolLifePolicySchema = z.enum(["TIME", "CYCLE", "PART_COUNT"]);
const physicalToolStatusSchema = z.enum(["AVAILABLE", "RESERVED", "IN_USE", "EXPIRED", "BROKEN", "QUARANTINED", "RETIRED"]);
const physicalFixtureStatusSchema = z.enum(["AVAILABLE", "RESERVED", "IN_USE", "MAINTENANCE", "QUARANTINED", "RETIRED"]);
const nonNegative = decimalString.refine((n) => n >= 0, "Negative value is not allowed");

const toolDefinitionFields = z.object({
  code: z.string().trim().min(1).max(80), name: z.string().trim().min(1).max(200), toolType: z.string().trim().min(1).max(80),
  manufacturerCode: z.string().trim().max(120).optional(), lifePolicy: toolLifePolicySchema,
  maximumLife: positiveQty, warningThreshold: nonNegative, lifeUnit: z.string().trim().min(1).max(24), revision: z.string().trim().min(1).max(40).default("A"), isActive: z.boolean().default(true),
});
export const createToolDefinitionSchema = toolDefinitionFields.superRefine((v, ctx) => { if (v.warningThreshold > v.maximumLife) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Warning threshold cannot exceed maximum life", path: ["warningThreshold"] }); });
export const updateToolDefinitionSchema = toolDefinitionFields.partial().superRefine((v, ctx) => { if (v.maximumLife !== undefined && v.warningThreshold !== undefined && v.warningThreshold > v.maximumLife) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Warning threshold cannot exceed maximum life", path: ["warningThreshold"] }); });
export type CreateToolDefinitionDto = z.infer<typeof createToolDefinitionSchema>;
export type UpdateToolDefinitionDto = z.infer<typeof updateToolDefinitionSchema>;

export const createToolComponentSchema = z.object({ componentType: z.string().trim().min(1), code: z.string().trim().min(1), name: z.string().trim().min(1), manufacturerCode: z.string().trim().optional(), revision: z.string().trim().min(1).default("A"), isActive: z.boolean().default(true) });
export const createToolAssemblySchema = z.object({ toolDefinitionId: idSchema, code: z.string().trim().min(1), name: z.string().trim().min(1), revision: z.string().trim().min(1).default("A"), isActive: z.boolean().default(true), componentIds: z.array(idSchema).min(1).refine((ids) => new Set(ids).size === ids.length, "Duplicate assembly component") });
export const createPhysicalToolSchema = z.object({ toolDefinitionId: idSchema, toolAssemblyId: idSchema.optional(), serialNo: z.string().trim().min(1), barcode: z.string().trim().min(1).optional(), location: z.string().trim().optional(), consumedLife: nonNegative.default(0), remainingLife: nonNegative, status: physicalToolStatusSchema.default("AVAILABLE") });
export const createFixtureDefinitionSchema = z.object({ code: z.string().trim().min(1), name: z.string().trim().min(1), fixtureType: z.string().trim().min(1), revision: z.string().trim().min(1).default("A"), isActive: z.boolean().default(true) });
export const createPhysicalFixtureSchema = z.object({ fixtureDefinitionId: idSchema, serialNo: z.string().trim().min(1), barcode: z.string().trim().min(1).optional(), location: z.string().trim().optional(), status: physicalFixtureStatusSchema.default("AVAILABLE") });
export const createToolCompatibilitySchema = z.object({ machineId: idSchema, toolDefinitionId: idSchema.optional(), toolAssemblyId: idSchema.optional() }).refine((v) => Boolean(v.toolDefinitionId) !== Boolean(v.toolAssemblyId), "Exactly one tool definition or assembly is required");
export const createFixtureCompatibilitySchema = z.object({ machineId: idSchema, fixtureDefinitionId: idSchema });
export const createOperationToolRequirementSchema = z.object({ toolDefinitionId: idSchema.optional(), toolAssemblyId: idSchema.optional(), isRequired: z.boolean().default(true), quantity: z.number().int().positive().default(1), alternativeGroup: z.string().trim().min(1).optional(), sequence: z.number().int().positive().default(1) }).refine((v) => Boolean(v.toolDefinitionId) !== Boolean(v.toolAssemblyId), "Exactly one tool definition or assembly is required");
export const createOperationFixtureRequirementSchema = z.object({ fixtureDefinitionId: idSchema, isRequired: z.boolean().default(true), quantity: z.number().int().positive().default(1), alternativeGroup: z.string().trim().min(1).optional(), sequence: z.number().int().positive().default(1) });
export const setupAssignmentSchema = z.object({ toolAssignments: z.array(z.object({ requirementId: idSchema, physicalToolInstanceId: idSchema })).default([]), fixtureAssignments: z.array(z.object({ requirementId: idSchema, physicalFixtureInstanceId: idSchema })).default([]) }).superRefine((v, ctx) => { const ids = [...v.toolAssignments.map((x) => x.physicalToolInstanceId), ...v.fixtureAssignments.map((x) => x.physicalFixtureInstanceId)]; if (new Set(ids).size !== ids.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A physical resource cannot be assigned twice" }); });
export const invalidateSetupSchema = z.object({ reason: z.string().trim().min(1).max(500) });
export const manualToolLifeAdjustmentSchema = z.object({ consumedLife: nonNegative, version: z.number().int().positive(), reason: z.string().trim().min(1).max(500) });
export type CreateToolComponentDto = z.infer<typeof createToolComponentSchema>;
export type CreateToolAssemblyDto = z.infer<typeof createToolAssemblySchema>;
export type CreatePhysicalToolDto = z.infer<typeof createPhysicalToolSchema>;
export type CreateFixtureDefinitionDto = z.infer<typeof createFixtureDefinitionSchema>;
export type CreatePhysicalFixtureDto = z.infer<typeof createPhysicalFixtureSchema>;
export type SetupAssignmentDto = z.infer<typeof setupAssignmentSchema>;

// ---- MES-FIXTURE-MAINT-001 fixture maintenance / calibration ----
const fixturePolicyTypeSchema = z.enum(["TIME", "CYCLE", "PART_COUNT"]);
const fixtureEnforcementSchema = z.enum(["INFORMATIONAL", "WARNING", "BLOCKING"]);
const fixtureMaintenanceResultSchema = z.enum(["PASS", "FAIL"]);
const fixtureMaintenancePolicyFields = z.object({ fixtureDefinitionId: idSchema, policyType: fixturePolicyTypeSchema, interval: positiveQty, warningThreshold: nonNegative.optional(), enforcement: fixtureEnforcementSchema.default("INFORMATIONAL"), isActive: z.boolean().default(true) });
export const fixtureMaintenancePolicySchema = fixtureMaintenancePolicyFields.superRefine((v, ctx) => { if (v.warningThreshold !== undefined && v.warningThreshold > v.interval) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["warningThreshold"], message: "Warning threshold cannot exceed interval" }); });
export const updateFixtureMaintenancePolicySchema = fixtureMaintenancePolicyFields.omit({ fixtureDefinitionId: true }).partial().extend({ version: z.number().int().positive() });
const fixtureCalibrationPolicyFields = z.object({ fixtureDefinitionId: idSchema, intervalDays: z.number().int().positive(), warningDays: z.number().int().nonnegative().optional(), enforcement: fixtureEnforcementSchema.default("INFORMATIONAL"), certificateRequired: z.boolean().default(false), isActive: z.boolean().default(true) });
export const fixtureCalibrationPolicySchema = fixtureCalibrationPolicyFields.superRefine((v, ctx) => { if (v.warningDays !== undefined && v.warningDays > v.intervalDays) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["warningDays"], message: "Warning period cannot exceed calibration interval" }); });
export const updateFixtureCalibrationPolicySchema = fixtureCalibrationPolicyFields.omit({ fixtureDefinitionId: true }).partial().extend({ version: z.number().int().positive() });
export const scheduleFixtureMaintenanceSchema = z.object({ physicalFixtureInstanceId: idSchema, fixtureMaintenancePolicyId: idSchema.optional(), maintenanceType: z.string().trim().min(1).max(80), notes: z.string().trim().max(2000).optional(), documentId: idSchema.optional(), idempotencyKey: z.string().trim().min(8).max(160) });
export const completeFixtureMaintenanceSchema = z.object({ result: fixtureMaintenanceResultSchema, notes: z.string().trim().max(2000).optional(), documentId: idSchema.optional(), counterBefore: nonNegative.optional(), counterAfter: nonNegative.optional(), version: z.number().int().positive(), idempotencyKey: z.string().trim().min(8).max(160) }).superRefine((v, ctx) => { if (v.counterBefore !== undefined && v.counterAfter !== undefined && v.counterAfter < v.counterBefore) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["counterAfter"], message: "Counter cannot move backwards" }); });
export const fixtureCalibrationRecordSchema = z.object({ physicalFixtureInstanceId: idSchema, calibratedAt: isoDate, validUntil: isoDate, result: fixtureMaintenanceResultSchema, certificateDocumentId: idSchema.optional(), reference: z.string().trim().max(200).optional(), provider: z.string().trim().max(200).optional(), idempotencyKey: z.string().trim().min(8).max(160) }).superRefine((v, ctx) => { if (v.validUntil < v.calibratedAt) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["validUntil"], message: "validUntil cannot precede calibratedAt" }); });
export const invalidateFixtureCalibrationSchema = z.object({ version: z.number().int().positive(), reason: z.string().trim().min(1).max(500) });
export const fixtureCounterAdjustmentSchema = z.object({ maintenanceCycleCount: nonNegative, maintenancePartCount: nonNegative, version: z.number().int().positive(), reason: z.string().trim().min(1).max(500) });
export type FixtureMaintenancePolicyDto = z.infer<typeof fixtureMaintenancePolicySchema>;
export type FixtureCalibrationPolicyDto = z.infer<typeof fixtureCalibrationPolicySchema>;
export type ScheduleFixtureMaintenanceDto = z.infer<typeof scheduleFixtureMaintenanceSchema>;
export type CompleteFixtureMaintenanceDto = z.infer<typeof completeFixtureMaintenanceSchema>;
export type FixtureCalibrationRecordDto = z.infer<typeof fixtureCalibrationRecordSchema>;

// ---- Auth ----
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const updateProfileSchema = z.object({
  locale: z.enum(["tr", "en"]).optional(),
  timezone: z.string().optional(),
});
export type UpdateProfileDto = z.infer<typeof updateProfileSchema>;

// ---- User ----
export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  role: RoleSchema,
  isActive: z.boolean().default(true),
  department: z.string().optional(),
  position: z.string().optional(),
  hourlyRate: z.coerce.number().nonnegative().optional(),
  /// LDAP burada YOK — o kaynak sadece /ldap/sync (AD içe aktarma) ile atanır.
  /// OIDC ise burada elle seçilebilir, çünkü LDAP'ın aksine bir "dizin
  /// senkronizasyonu" adımı yok (bkz. Faz O).
  authSource: z.enum(["LOCAL", "OIDC"]).optional(),
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

// ---- OIDC Provider (Faz O) ----
export const createOidcProviderSchema = z.object({
  name: z.string().min(1),
  issuer: z.string().url(),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  scope: z.string().min(1).default("openid email profile"),
  emailClaim: z.string().min(1).default("email"),
  defaultRole: RoleSchema.default("OPERATOR"),
  isActive: z.boolean().default(true),
});
export type CreateOidcProviderDto = z.infer<typeof createOidcProviderSchema>;

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
  lotTrackingRequired: z.boolean().optional(),
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
  effectivityScope: z.string().min(1).max(120).default("GLOBAL"),
  effectiveFrom: isoDate.optional(),
  effectiveTo: isoDate.optional(),
});
export type CreateNcProgramDto = z.infer<typeof createNcProgramSchema>;

export const createNcProgramRevisionSchema = z.object({
  fileName: z.string().min(1),
  fileRef: z.string().min(1),
  notes: z.string().optional(),
  effectivityScope: z.string().min(1).max(120).optional(),
  effectiveFrom: isoDate.optional(),
  effectiveTo: isoDate.optional(),
});
export type CreateNcProgramRevisionDto = z.infer<typeof createNcProgramRevisionSchema>;

export const electronicSignatureSchema = z.object({
  password: z.string().min(1),
  note: z.string().max(1000).optional(),
});
export type ElectronicSignatureDto = z.infer<typeof electronicSignatureSchema>;

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
  // Faz G Cost Accounting'de eklenmişti ama şemaya hiç girmemişti — WorkOrdersService.cost()
  // bu alanı okuyordu ama UI'dan girilemiyordu (bkz. Faz H/I asimetri notu).
  standardCost: decimalString.optional(),
  lotTrackingRequired: z.boolean().optional(),
  certificateRequired: z.boolean().optional(),
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
  /// Faz I Predictive Maintenance: eşik girilirse (runtimeHours - lastPmRuntimeHours)
  /// aştığında öngörülü bakım tetiklenir.
  pmIntervalHours: z.coerce.number().nonnegative().optional(),
  // Faz G Cost Accounting'de eklenmişti ama şemaya hiç girmemişti — WorkOrdersService.cost()
  // bu alanı okuyordu ama UI'dan girilemiyordu (bkz. Faz H/I asimetri notu).
  hourlyRate: z.coerce.number().nonnegative().optional(),
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

// ---- RFQ (Faz C) — Quote'un öncesi, fiyatsız müşteri talebi ----
export const rfqLineInputSchema = z.object({
  partId: idSchema,
  quantity: positiveQty,
  dueDate: isoDate,
});
export const createRfqSchema = z.object({
  customerId: idSchema,
  validUntil: isoDate.optional(),
  notes: z.string().optional(),
  lines: z.array(rfqLineInputSchema).min(1),
});
export const rfqStatusUpdateSchema = z.object({ status: RFQStatusSchema });
export const updateRfqSchema = createRfqSchema.omit({ lines: true }).partial();
export const updateRfqLineSchema = rfqLineInputSchema.partial();
export const convertRfqSchema = z.object({ lineIds: z.array(idSchema).optional() });
export type CreateRfqDto = z.infer<typeof createRfqSchema>;
export type UpdateRfqDto = z.infer<typeof updateRfqSchema>;
export type RfqLineInputDto = z.infer<typeof rfqLineInputSchema>;
export type UpdateRfqLineDto = z.infer<typeof updateRfqLineSchema>;
export type ConvertRfqDto = z.infer<typeof convertRfqSchema>;
export type RfqStatusUpdateDto = z.infer<typeof rfqStatusUpdateSchema>;

// ---- SalesOrder (Faz C) — Quote.convert() artık bunu üretir; WorkOrder'a
// üretime alma (release) ayrı bir adımdır ----
export const salesOrderStatusUpdateSchema = z.object({ status: SalesOrderStatusSchema });
export type SalesOrderStatusUpdateDto = z.infer<typeof salesOrderStatusUpdateSchema>;
export const releaseSalesOrderSchema = z.object({ lineIds: z.array(idSchema).optional() });
export type ReleaseSalesOrderDto = z.infer<typeof releaseSalesOrderSchema>;

// ---- Delivery (Faz C Pass 2) — sevkiyat, tek seferlik olay (taslak yok) ----
export const deliveryLineInputSchema = z.object({
  salesOrderLineId: idSchema,
  qty: positiveQty,
  binId: idSchema.optional(),
  lotId: idSchema.optional(),
});
export const createDeliverySchema = z.object({
  salesOrderId: idSchema,
  notes: z.string().optional(),
  lines: z.array(deliveryLineInputSchema).min(1),
});
export type CreateDeliveryDto = z.infer<typeof createDeliverySchema>;

// ---- Invoice (Faz C Pass 2) — sadece kesildi/iptal, ödeme/AR takibi yok ----
export const invoiceLineInputSchema = z.object({
  salesOrderLineId: idSchema,
  qty: positiveQty,
});
export const createInvoiceSchema = z.object({
  salesOrderId: idSchema,
  notes: z.string().optional(),
  lines: z.array(invoiceLineInputSchema).min(1),
});
export type CreateInvoiceDto = z.infer<typeof createInvoiceSchema>;
export const invoiceStatusUpdateSchema = z.object({ status: InvoiceStatusSchema });
export type InvoiceStatusUpdateDto = z.infer<typeof invoiceStatusUpdateSchema>;

// ---- CustomerNote (Faz C Pass 2) — basit CRM, append-only aktivite notu ----
export const createCustomerNoteSchema = z.object({ note: z.string().min(1) });
export type CreateCustomerNoteDto = z.infer<typeof createCustomerNoteSchema>;

// ---- Warehouse / Bin (Faz D) ----
export const createWarehouseSchema = z.object({
  name: z.string().min(1),
  code: z.string().optional(),
});
export const updateWarehouseSchema = createWarehouseSchema.partial();
export type CreateWarehouseDto = z.infer<typeof createWarehouseSchema>;
export type UpdateWarehouseDto = z.infer<typeof updateWarehouseSchema>;

export const createBinSchema = z.object({
  warehouseId: idSchema,
  code: z.string().min(1),
  name: z.string().optional(),
});
export const updateBinSchema = z.object({ name: z.string().optional() });
export type CreateBinDto = z.infer<typeof createBinSchema>;
export type UpdateBinDto = z.infer<typeof updateBinSchema>;

// ---- Lot (Faz D) ----
export const createLotSchema = z.object({
  lotNo: z.string().min(1),
  itemType: StockItemTypeSchema,
  itemId: idSchema,
  expiryDate: isoDate.optional(),
  heatNumber: z.string().min(1).optional(),
  supplierLotNo: z.string().min(1).optional(),
  certificateNo: z.string().min(1).optional(),
});
export type CreateLotDto = z.infer<typeof createLotSchema>;
export const decideLotAcceptanceSchema = z.object({
  status: LotAcceptanceStatusSchema,
  note: z.string().min(1).optional(),
});
export type DecideLotAcceptanceDto = z.infer<typeof decideLotAcceptanceSchema>;

// ---- SerialNumber (Faz K) — Lot'a paralel, tekil fiziksel ürün birimi takibi ----
export const createSerialNumberSchema = z.object({
  serialNo: z.string().min(1),
  partId: idSchema,
  workOrderId: idSchema.optional(),
  lotId: idSchema.optional(),
});
export type CreateSerialNumberDto = z.infer<typeof createSerialNumberSchema>;

// ---- Project Management (Faz L) ----
export const createProjectSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
});
export type CreateProjectDto = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  status: ProjectStatusSchema.optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
});
export type UpdateProjectDto = z.infer<typeof updateProjectSchema>;

export const createProjectTaskSchema = z.object({
  name: z.string().min(1),
  parentTaskId: idSchema.optional(),
  assigneeId: idSchema.optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
});
export type CreateProjectTaskDto = z.infer<typeof createProjectTaskSchema>;

export const updateProjectTaskSchema = z.object({
  name: z.string().min(1).optional(),
  assigneeId: idSchema.optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  status: ProjectTaskStatusSchema.optional(),
});
export type UpdateProjectTaskDto = z.infer<typeof updateProjectTaskSchema>;

export const createProjectTimeEntrySchema = z.object({
  hours: positiveQty,
  date: isoDate.optional(),
});
export type CreateProjectTimeEntryDto = z.infer<typeof createProjectTimeEntrySchema>;

// ---- CRM: Lead + Opportunity (Faz M) ----
export const createLeadSchema = z.object({
  companyName: z.string().min(1),
  contactName: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  source: z.string().optional(),
});
export type CreateLeadDto = z.infer<typeof createLeadSchema>;

export const updateLeadSchema = z.object({
  companyName: z.string().min(1).optional(),
  contactName: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  source: z.string().optional(),
  status: LeadStatusSchema.optional(),
});
export type UpdateLeadDto = z.infer<typeof updateLeadSchema>;

export const createOpportunitySchema = z.object({
  customerId: idSchema,
  title: z.string().min(1),
  estimatedValue: decimalString.optional(),
  expectedCloseDate: isoDate.optional(),
});
export type CreateOpportunityDto = z.infer<typeof createOpportunitySchema>;

export const updateOpportunitySchema = z.object({
  title: z.string().min(1).optional(),
  stage: OpportunityStageSchema.optional(),
  estimatedValue: decimalString.optional(),
  expectedCloseDate: isoDate.optional(),
  lostReason: z.string().optional(),
});
export type UpdateOpportunityDto = z.infer<typeof updateOpportunitySchema>;

// ---- Service Management (Faz N) ----
export const createServiceTicketSchema = z.object({
  customerId: idSchema,
  subject: z.string().min(1),
  description: z.string().optional(),
  priority: ServiceTicketPrioritySchema.optional(),
});
export type CreateServiceTicketDto = z.infer<typeof createServiceTicketSchema>;

export const resolveServiceTicketSchema = z.object({
  status: ServiceTicketStatusSchema,
  /// NonConformance.resolve() ile aynı desen — sadece status=RESOLVED iken zorunlu.
  resolutionNote: z.string().min(1).optional(),
});
export type ResolveServiceTicketDto = z.infer<typeof resolveServiceTicketSchema>;

// ---- TransferOrder (Faz D) — Bin→Bin, Delivery gibi tek seferlik olay ----
export const transferOrderLineInputSchema = z.object({
  itemType: StockItemTypeSchema,
  itemId: idSchema,
  lotId: idSchema.optional(),
  qty: positiveQty,
});
export const createTransferOrderSchema = z.object({
  fromBinId: idSchema,
  toBinId: idSchema,
  notes: z.string().optional(),
  lines: z.array(transferOrderLineInputSchema).min(1),
});
export type CreateTransferOrderDto = z.infer<typeof createTransferOrderSchema>;

// ---- CycleCount (Faz D) — OPEN'da sayım girilir, POSTED'da StockBalance düzeltilir ----
export const cycleCountLineInputSchema = z.object({
  itemType: StockItemTypeSchema,
  itemId: idSchema,
  lotId: idSchema.optional(),
  countedQty: decimalString.refine((n) => n >= 0, "Sayılan miktar negatif olamaz"),
});
export const createCycleCountSchema = z.object({
  binId: idSchema,
  lines: z.array(cycleCountLineInputSchema).min(1),
});
export type CreateCycleCountDto = z.infer<typeof createCycleCountSchema>;

// ---- Inspection (Faz E) — FAIL sonucunda servis katmanında otomatik NonConformance üretir ----
export const createInspectionSchema = z.object({
  workOrderId: idSchema,
  productionRunId: idSchema.optional(),
  qualityPlanCheckId: idSchema.optional(),
  checkpointName: z.string().min(1),
  result: InspectionResultSchema,
  measurementValue: decimalString.optional(),
  measurementUnit: z.string().min(1).optional(),
  notes: z.string().optional(),
});
export type CreateInspectionDto = z.infer<typeof createInspectionSchema>;

export const qualityPlanCheckSchema = z
  .object({
    seq: z.number().int().positive(),
    checkpointName: z.string().min(1),
    operationSeq: z.number().int().positive().optional(),
    unit: z.string().min(1).optional(),
    lowerLimit: decimalString.optional(),
    upperLimit: decimalString.optional(),
    requiresMeasurement: z.boolean().optional(),
  })
  .superRefine((check, ctx) => {
    if (check.lowerLimit !== undefined && check.upperLimit !== undefined && check.lowerLimit > check.upperLimit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["upperLimit"],
        message: "Ust tolerans alt toleranstan kucuk olamaz",
      });
    }
  });
export const createQualityPlanSchema = z.object({
  name: z.string().min(1),
  revision: z.string().min(1).max(32).optional(),
  partId: idSchema.optional(),
  checks: z.array(qualityPlanCheckSchema).min(1),
});
export type CreateQualityPlanDto = z.infer<typeof createQualityPlanSchema>;

/** Mevcut planın kontrol satırlarını değiştirmeden yeni kontrollü revizyon açar. */
export const createQualityPlanRevisionSchema = z.object({
  revision: z.string().min(1).max(32),
});
export type CreateQualityPlanRevisionDto = z.infer<typeof createQualityPlanRevisionSchema>;

// This proposal schema does not authorize or execute a mutation.
export const createCopilotDraftSchema = z.object({
  prompt: z.string().trim().min(3).max(4_000),
});
export type CreateCopilotDraftDto = z.infer<typeof createCopilotDraftSchema>;

// ---- Capa (Faz E) — onay akışı ApprovalsService üzerinden yürür ----
export const createCapaSchema = z.object({
  sourceNonConformanceId: idSchema.optional(),
  title: z.string().min(1),
  rootCause: z.string().optional(),
  actionPlan: z.string().optional(),
});
export type CreateCapaDto = z.infer<typeof createCapaSchema>;
export const updateCapaSchema = z.object({
  rootCause: z.string().optional(),
  actionPlan: z.string().optional(),
});
export type UpdateCapaDto = z.infer<typeof updateCapaSchema>;
export const decideCapaSchema = z.object({ note: z.string().optional() });
export type DecideCapaDto = z.infer<typeof decideCapaSchema>;

// ---- Calibration (Faz E) — takvim bazlı, Machine'e bağlı ----
export const createCalibrationSchema = z.object({
  machineId: idSchema,
  calibratedAt: isoDate,
  nextDueDate: isoDate,
  notes: z.string().optional(),
});
export type CreateCalibrationDto = z.infer<typeof createCalibrationSchema>;

// ---- MaintenanceOrder (Faz E takvim bazlı PM/CM + Faz I runtime-hour öngörülü tetikleme) ----
export const createMaintenanceOrderSchema = z.object({
  machineId: idSchema,
  type: MaintenanceOrderTypeSchema,
  scheduledDate: isoDate,
  notes: z.string().optional(),
});
export type CreateMaintenanceOrderDto = z.infer<typeof createMaintenanceOrderSchema>;
export const completeMaintenanceOrderSchema = z.object({ notes: z.string().optional() });
export type CompleteMaintenanceOrderDto = z.infer<typeof completeMaintenanceOrderSchema>;

// ---- EnergyReading (Faz I Energy Monitoring) — manuel kwh girişi, otomatik telemetri yok ----
export const createEnergyReadingSchema = z.object({
  machineId: idSchema,
  kwh: decimalString,
  recordedAt: isoDate.optional(),
  notes: z.string().optional(),
});
export type CreateEnergyReadingDto = z.infer<typeof createEnergyReadingSchema>;

// ---- WebhookSubscription (Faz J Developer Platform) ----
export const createWebhookSubscriptionSchema = z.object({
  url: z.string().url(),
  event: z.string().min(1),
  secret: z.string().optional(),
  isActive: z.boolean().default(true),
});
export const updateWebhookSubscriptionSchema = createWebhookSubscriptionSchema.partial();
export type CreateWebhookSubscriptionDto = z.infer<typeof createWebhookSubscriptionSchema>;
export type UpdateWebhookSubscriptionDto = z.infer<typeof updateWebhookSubscriptionSchema>;

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

// ---- WorkOrder route operation (AHK-004) ----
export const updateWorkOrderOperationSchema = z.object({
  machineId: idSchema.nullable().optional(),
  ncProgramId: idSchema.nullable().optional(),
  status: WorkOrderOperationStatusSchema.optional(),
  notes: z.string().optional(),
});
export const completeWorkOrderOperationSchema = z.object({
  notes: z.string().optional(),
});
export type UpdateWorkOrderOperationDto = z.infer<typeof updateWorkOrderOperationSchema>;
export type CompleteWorkOrderOperationDto = z.infer<typeof completeWorkOrderOperationSchema>;

// ---- PurchaseOrder (Faz 0b) ----
export const purchaseOrderLineInputSchema = z.object({
  materialId: idSchema,
  quantity: positiveQty,
  unitPrice: decimalString,
});
export const createPurchaseOrderSchema = z.object({
  supplierId: idSchema,
  currency: z.string().default("TRY"),
  orderDate: isoDate,
  expectedDate: isoDate.optional(),
  notes: z.string().optional(),
  lines: z.array(purchaseOrderLineInputSchema).min(1),
});
export const receivePurchaseOrderSchema = z.object({
  lines: z.array(z.object({
    lineId: idSchema,
    receivedQty: positiveQty,
    /// Raf verilmezse legacy quantities için otomatik UNASSIGNED raf kullanılır.
    binId: idSchema.optional(),
    lotId: idSchema.optional(),
  })).min(1),
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
  /// Faz F: tüketilen malzemenin geldiği lot — backward traceability için opsiyonel.
  lotId: idSchema.optional(),
  /// Raf verilmezse legacy quantities için otomatik UNASSIGNED raf kullanılır.
  binId: idSchema.optional(),
});
export type CreateConsumptionDto = z.infer<typeof createConsumptionSchema>;

// ---- ProductionRun (Faz 0c) — source her zaman MANUAL, API girişinde alınmaz ----
export const startProductionRunSchema = z.object({
  machineId: idSchema.optional(),
  /** Rotası olan iş emirlerinde zorunludur; koşuyu sabitlenmiş operasyon/WIP'ye bağlar. */
  operationId: idSchema.optional(),
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

// ---- Operator HMI (MES-OPERATOR-HMI-001) ----
export const hmiOperationQueueQuerySchema = z.object({
  machineId: idSchema.optional(),
  status: WorkOrderOperationStatusSchema.optional(),
});
export const hmiCompleteOperationSchema = z.object({
  goodCount: z.number().int().min(0),
  scrapCount: z.number().int().min(0).default(0),
  notes: z.string().max(2000).optional(),
});
export type HmiOperationQueueQueryDto = z.infer<typeof hmiOperationQueueQuerySchema>;
export type HmiCompleteOperationDto = z.infer<typeof hmiCompleteOperationSchema>;

// ---- FinishedGoodsEntry (Faz 0c) ----
export const createFinishedGoodsSchema = z.object({
  workOrderId: idSchema,
  quantity: positiveQty,
  date: isoDate.optional(),
  /// Faz F: üretilen mamulün atandığı lot — forward traceability için opsiyonel.
  lotId: idSchema.optional(),
  /// Raf verilmezse legacy quantities için otomatik UNASSIGNED raf kullanılır.
  binId: idSchema.optional(),
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

export const createApprovalRequestSchema = z.object({
  entity: z.string().min(1),
  entityId: idSchema,
  requiredRoles: z.array(RoleSchema).min(1),
  note: z.string().optional(),
});
export type CreateApprovalRequestDto = z.infer<typeof createApprovalRequestSchema>;

export const decideApprovalSchema = z.object({
  note: z.string().optional(),
});
export type DecideApprovalDto = z.infer<typeof decideApprovalSchema>;

// ---- BOM (Faz B) ----
export const bomLineInputSchema = z.object({
  materialId: idSchema,
  qtyPer: positiveQty,
  scrapPct: decimalString.optional(),
});
export const createBomHeaderSchema = z.object({
  partId: idSchema,
  revision: z.string().min(1).default("A"),
  notes: z.string().optional(),
  lines: z.array(bomLineInputSchema).min(1),
});
export type CreateBomHeaderDto = z.infer<typeof createBomHeaderSchema>;
export const updateBomHeaderSchema = z.object({
  notes: z.string().optional(),
  isActive: z.boolean().optional(),
  lines: z.array(bomLineInputSchema).min(1).optional(),
});
export type UpdateBomHeaderDto = z.infer<typeof updateBomHeaderSchema>;

// ---- Recipe (Faz F) — süreç reçetesi versiyonlama, BomHeader ile aynı desen ----
export const recipeStepInputSchema = z.object({
  seq: z.number().int().min(1),
  name: z.string().min(1),
  parameterName: z.string().optional(),
  parameterValue: z.string().optional(),
  unit: z.string().optional(),
  ncProgramId: idSchema.optional(),
});
export const createRecipeHeaderSchema = z.object({
  partId: idSchema,
  revision: z.string().min(1).default("A"),
  notes: z.string().optional(),
  steps: z.array(recipeStepInputSchema).min(1),
});
export type CreateRecipeHeaderDto = z.infer<typeof createRecipeHeaderSchema>;
export const updateRecipeHeaderSchema = z.object({
  notes: z.string().optional(),
  isActive: z.boolean().optional(),
  steps: z.array(recipeStepInputSchema).min(1).optional(),
});
export type UpdateRecipeHeaderDto = z.infer<typeof updateRecipeHeaderSchema>;

// ---- SPC (Faz F) — karakteristik tanımı + ölçüm kaydı ----
export const createSpcCharacteristicSchema = z.object({
  partId: idSchema,
  name: z.string().min(1),
  unit: z.string().optional(),
  target: decimalString.optional(),
  uslUpper: decimalString.optional(),
  lslLower: decimalString.optional(),
});
export type CreateSpcCharacteristicDto = z.infer<typeof createSpcCharacteristicSchema>;
export const createSpcMeasurementSchema = z.object({
  characteristicId: idSchema,
  workOrderId: idSchema.optional(),
  value: decimalString,
  measuredAt: isoDate.optional(),
});
export type CreateSpcMeasurementDto = z.infer<typeof createSpcMeasurementSchema>;

// ---- Alarm Management (Faz F) ----
export const createAlarmDefinitionSchema = z.object({
  code: z.string().min(1),
  description: z.string().min(1),
  severity: AlarmSeveritySchema.default("MEDIUM"),
  machineId: idSchema.optional(),
});
export type CreateAlarmDefinitionDto = z.infer<typeof createAlarmDefinitionSchema>;
export const updateAlarmDefinitionSchema = createAlarmDefinitionSchema.partial();
export type UpdateAlarmDefinitionDto = z.infer<typeof updateAlarmDefinitionSchema>;
export const acknowledgeAlarmSchema = z.object({ note: z.string().optional() });
export type AcknowledgeAlarmDto = z.infer<typeof acknowledgeAlarmSchema>;

// ---- Faz G AP (Accounts Payable) — SupplierInvoice, Invoice ile aynı desen ----
export const supplierInvoiceLineInputSchema = z.object({
  purchaseOrderLineId: idSchema,
  qty: positiveQty,
});
export const createSupplierInvoiceSchema = z.object({
  purchaseOrderId: idSchema,
  notes: z.string().optional(),
  lines: z.array(supplierInvoiceLineInputSchema).min(1),
});
export type CreateSupplierInvoiceDto = z.infer<typeof createSupplierInvoiceSchema>;

export const paymentAllocationInputSchema = z.object({
  amount: positiveQty,
});
export const createSupplierPaymentSchema = z.object({
  supplierId: idSchema,
  paymentDate: isoDate.optional(),
  notes: z.string().optional(),
  allocations: z
    .array(paymentAllocationInputSchema.extend({ supplierInvoiceId: idSchema }))
    .min(1),
});
export type CreateSupplierPaymentDto = z.infer<typeof createSupplierPaymentSchema>;

// ---- Faz G AR (Accounts Receivable) — CustomerPayment, SupplierPayment ile aynı desen ----
export const createCustomerPaymentSchema = z.object({
  customerId: idSchema,
  paymentDate: isoDate.optional(),
  notes: z.string().optional(),
  allocations: z.array(paymentAllocationInputSchema.extend({ invoiceId: idSchema })).min(1),
});
export type CreateCustomerPaymentDto = z.infer<typeof createCustomerPaymentSchema>;

// ---- MRP (Faz B) — proposal onay/red, gerekirse tedarikçisiz öneriye tedarikçi atanır ----
export const mrpProposalDecisionSchema = z.object({
  note: z.string().optional(),
  supplierId: idSchema.optional(),
});
export type MrpProposalDecisionDto = z.infer<typeof mrpProposalDecisionSchema>;
