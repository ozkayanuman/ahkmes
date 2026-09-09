import { z } from "zod";
import {
  AlarmSeveritySchema,
  DowntimeReasonCategorySchema,
  ProductionLossCategorySchema,
  ConsumptionTypeSchema,
  DocumentEntityTypeSchema,
  DocumentTypeSchema,
  MachineConnectorTypeSchema,
  ControllerCapabilitySchema,
  ControllerConnectionStateSchema,
  ControllerMachineStateSchema,
  ControllerObservationTrustSchema,
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
  MaintenanceOrderStatusSchema,
  MaintenancePrioritySchema,
  MachineMaintenanceStateSchema,
  MaintenanceCodeKindSchema,
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
  EngineeringStatusSchema,
  MrpPlanningPolicySchema,
  MrpLotSizingRuleSchema,
  UomDimensionSchema,
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
  unit: z.string().min(1).max(32).default("EA"),
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
  unit: z.string().min(1).max(32),
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
  controllerVerificationRequired: z.boolean().default(false),
  controllerFreshnessSeconds: z.number().int().min(5).max(3600).default(60),
  /// Saha hiyerarşisindeki yeri — null: yerleştirilmemiş/kaldırılmış.
  unitId: idSchema.nullable().optional(),
  /// Faz I Predictive Maintenance: eşik girilirse (runtimeHours - lastPmRuntimeHours)
  /// aştığında öngörülü bakım tetiklenir.
  pmIntervalHours: z.coerce.number().nonnegative().optional(),
  // Faz G Cost Accounting'de eklenmişti ama şemaya hiç girmemişti — WorkOrdersService.cost()
  // bu alanı okuyordu ama UI'dan girilemiyordu (bkz. Faz H/I asimetri notu).
  hourlyRate: z.coerce.number().nonnegative().optional(),
  // AHK-011: opsiyonel — girilmezse SchedulingService.capacity() bu makineyi
  // yük/aşım hesabına dahil etmez.
  dailyCapacityMinutes: z.coerce.number().nonnegative().optional(),
});
export const updateMachineSchema = createMachineSchema.partial();
export type CreateMachineDto = z.infer<typeof createMachineSchema>;
export type UpdateMachineDto = z.infer<typeof updateMachineSchema>;

// ---- Saha hiyerarşisi (Plant > Area > Workplace > Unit) ----
export const createPlantSchema = z.object({
  name: z.string().min(1),
  code: z.string().optional(),
  location: z.string().optional(),
  timezone: z.string().min(1).max(80).default("Europe/Istanbul"),
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
export const assignSalesOrderFulfillmentPlantSchema = z.object({ plantId: idSchema });
export type AssignSalesOrderFulfillmentPlantDto = z.infer<typeof assignSalesOrderFulfillmentPlantSchema>;

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
    characteristicType: z.enum(["NUMERIC", "BOOLEAN", "QUALITATIVE"]).optional().default("NUMERIC"),
    nominalValue: decimalString.optional(),
    qualitativeExpected: z.string().min(1).max(120).optional(),
    isRequired: z.boolean().optional().default(true),
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
  samplingMethod: z.enum(["HUNDRED_PERCENT", "FIXED_COUNT"]).optional().default("HUNDRED_PERCENT"),
  sampleCount: z.number().int().positive().optional(),
  checks: z.array(qualityPlanCheckSchema).min(1),
}).superRefine((plan, ctx) => { if (plan.samplingMethod === "FIXED_COUNT" && !plan.sampleCount) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sampleCount"], message: "Fixed-count sampling requires sampleCount" }); });
export type CreateQualityPlanDto = z.infer<typeof createQualityPlanSchema>;

/** Mevcut planın kontrol satırlarını değiştirmeden yeni kontrollü revizyon açar. */
export const createQualityPlanRevisionSchema = z.object({
  revision: z.string().min(1).max(32),
});
export type CreateQualityPlanRevisionDto = z.infer<typeof createQualityPlanRevisionSchema>;

export const createInspectionLotSchema = z.object({ requirementId: idSchema, operationId: idSchema.optional(), productionRunId: idSchema.optional(), lotId: idSchema.optional(), idempotencyKey: z.string().min(8).max(160) });
export type CreateInspectionLotDto = z.infer<typeof createInspectionLotSchema>;
export const submitInspectionMeasurementSchema = z.object({ sampleNo: z.number().int().positive(), checkSeq: z.number().int().positive(), numericValue: decimalString.optional(), resultValue: z.string().min(1).max(120).optional(), unit: z.string().min(1).max(32).optional(), notes: z.string().max(1000).optional(), idempotencyKey: z.string().min(8).max(160) });
export type SubmitInspectionMeasurementDto = z.infer<typeof submitInspectionMeasurementSchema>;
export const createQualityDispositionSchema = z.object({ type: z.enum(["ACCEPT", "USE_AS_IS", "REWORK", "SCRAP"]), quantity: decimalString.optional(), reason: z.string().min(3).max(1000), idempotencyKey: z.string().min(8).max(160) });
export type CreateQualityDispositionDto = z.infer<typeof createQualityDispositionSchema>;
export const qualityReleaseSchema = z.object({ reason: z.string().min(3).max(1000), idempotencyKey: z.string().min(8).max(160) });
export type QualityReleaseDto = z.infer<typeof qualityReleaseSchema>;

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
/// AHK-006: CAPA karar bir ApprovalRequest kararıdır — kritik kalite kararı için
/// yeniden kimlik doğrulama (electronicSignatureSchema ile aynı `password` alanı) zorunlu.
export const decideCapaSchema = z.object({ note: z.string().optional(), password: z.string().min(1) });
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
  priority: MaintenancePrioritySchema.default("MEDIUM"),
  scheduledDate: isoDate.optional(),
  description: z.string().trim().min(1).max(4000).optional(),
  plannedStart: isoDate.optional(),
  plannedFinish: isoDate.optional(),
  blockingFrom: isoDate.optional(),
  blockingUntil: isoDate.optional(),
  idempotencyKey: z.string().trim().min(8).max(160).optional(),
  notes: z.string().optional(),
});
export type CreateMaintenanceOrderDto = z.infer<typeof createMaintenanceOrderSchema>;
export const completeMaintenanceOrderSchema = z.object({
  completionNotes: z.string().trim().min(1).max(4000).optional(),
  resolution: z.string().trim().min(1).max(4000).optional(),
  remedy: z.string().trim().min(1).max(4000).optional(),
  remedyCode: z.string().trim().min(1).max(80).optional(),
  machineDisposition: z.enum(["KEEP_OUT_OF_SERVICE", "READY_FOR_RETURN_TO_SERVICE", "REPAIRED"]).optional(),
  idempotencyKey: z.string().trim().min(8).max(160).optional(),
  notes: z.string().optional(),
});
export type CompleteMaintenanceOrderDto = z.infer<typeof completeMaintenanceOrderSchema>;

export const createMaintenanceRequestSchema = z.object({
  machineId: idSchema,
  problem: z.string().trim().min(1).max(500),
  priority: MaintenancePrioritySchema.default("MEDIUM"),
  description: z.string().trim().max(4000).optional(),
  reportedAt: isoDate.optional(),
  productionWorkOrderId: idSchema.optional(),
  documentId: idSchema.optional(),
  idempotencyKey: z.string().trim().min(8).max(160),
});
export type CreateMaintenanceRequestDto = z.infer<typeof createMaintenanceRequestSchema>;

export const declareMaintenanceBreakdownSchema = z.object({
  machineId: idSchema,
  requestId: idSchema.optional(),
  failureStartedAt: isoDate,
  failureCodeId: idSchema.optional(),
  description: z.string().trim().min(1).max(4000),
  priority: MaintenancePrioritySchema.default("HIGH"),
  productionImpact: z.string().trim().min(1).max(120).default("PRODUCTION_STOPPED"),
  idempotencyKey: z.string().trim().min(8).max(160),
});
export type DeclareMaintenanceBreakdownDto = z.infer<typeof declareMaintenanceBreakdownSchema>;

export const createMaintenancePlanSchema = z.object({
  machineId: idSchema, name: z.string().trim().min(1).max(200),
  frequency: z.number().int().positive().optional(), frequencyDays: z.number().int().positive().optional(), intervalDays: z.number().int().positive().optional(),
  effectiveStart: isoDate, nextDueAt: isoDate, warningDays: z.number().int().nonnegative().default(7),
  defaultPriority: MaintenancePrioritySchema.default("MEDIUM"), defaultDescription: z.string().max(4000).optional(),
  isActive: z.boolean().optional(),
  defaultTasks: z.array(z.object({ sequence: z.number().int().positive(), description: z.string().min(1), required: z.boolean().default(false) })).default([]),
}).refine((v) => Boolean(v.frequency ?? v.frequencyDays ?? v.intervalDays), "frequency is required");
export type CreateMaintenancePlanDto = z.infer<typeof createMaintenancePlanSchema>;

export const maintenanceTransitionSchema = z.object({ to: MaintenanceOrderStatusSchema, note: z.string().max(2000).optional(), idempotencyKey: z.string().min(8).max(160) });
export const assignMaintenanceTechnicianSchema = z.object({ technicianId: idSchema, isPrimary: z.boolean().default(false) });
export const addMaintenanceTaskSchema = z.object({ sequence: z.number().int().positive(), description: z.string().min(1).max(1000), required: z.boolean().default(false) });
export const completeMaintenanceTaskSchema = z.object({ completed: z.boolean().default(true) });
export const addMaintenanceLaborSchema = z.object({ technicianId: idSchema, workDate: isoDate, startedAt: isoDate.optional(), endedAt: isoDate.optional(), durationMinutes: z.number().int().positive().optional(), category: z.string().max(80).optional(), notes: z.string().max(2000).optional(), idempotencyKey: z.string().min(8).max(160) });
export const addMaintenanceSpareSchema = z.object({ itemType: StockItemTypeSchema, itemId: idSchema, plannedQuantity: positiveQty });
export const maintenanceSpareMovementSchema = z.object({ quantity: positiveQty, binId: idSchema, lotId: idSchema.optional(), idempotencyKey: z.string().min(8).max(160) });
export const returnToServiceSchema = z.object({ maintenanceOrderId: idSchema.optional(), breakdownId: idSchema.optional(), reason: z.string().min(1).max(1000), notes: z.string().max(2000).optional(), idempotencyKey: z.string().min(8).max(160) });
export const createMaintenanceCodeSchema = z.object({ kind: MaintenanceCodeKindSchema, code: z.string().min(1).max(80), label: z.string().min(1).max(200) });
export const maintenanceWorkbenchQuerySchema = z.object({ plantId: idSchema.optional(), machineId: idSchema.optional(), status: z.string().optional(), priority: MaintenancePrioritySchema.optional(), technicianId: idSchema.optional(), type: MaintenanceOrderTypeSchema.optional(), dueFrom: isoDate.optional(), dueTo: isoDate.optional() });

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
  plantId: idSchema.optional(),
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
  itemType: StockItemTypeSchema,
  itemId: idSchema,
  type: ConsumptionTypeSchema,
  quantity: positiveQty,
  date: isoDate.optional(),
  /// Faz F: tüketilen malzemenin geldiği lot — backward traceability için opsiyonel.
  lotId: idSchema.optional(),
  /// Raf verilmezse legacy quantities için otomatik UNASSIGNED raf kullanılır.
  binId: idSchema.optional(),
});
export type CreateConsumptionDto = z.infer<typeof createConsumptionSchema>;

// ---- CNC-V1-02 production material execution ----
export const createProductionMaterialReservationSchema = z.object({
  requirementId: idSchema,
  binId: idSchema,
  lotId: idSchema.optional(),
  quantity: positiveQty,
  idempotencyKey: z.string().min(8).max(160),
});
export const productionMaterialMutationSchema = z.object({
  requirementId: idSchema,
  reservationId: idSchema.optional(),
  quantity: positiveQty,
  binId: idSchema.optional(),
  lotId: idSchema.optional(),
  reasonCode: z.string().min(1).max(80).optional(),
  idempotencyKey: z.string().min(8).max(160),
});
export type CreateProductionMaterialReservationDto = z.infer<typeof createProductionMaterialReservationSchema>;
export type ProductionMaterialMutationDto = z.infer<typeof productionMaterialMutationSchema>;

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

// ---- CNC-V1-04 controlled MES lifecycle ----
export const hmiLifecycleCommandSchema = z.object({
  reasonCode: z.string().min(1).max(80).optional(),
  note: z.string().max(2000).optional(),
  idempotencyKey: z.string().min(8).max(160),
});
export const hmiProductionReportSchema = hmiLifecycleCommandSchema.extend({
  goodQty: z.number().min(0),
  scrapQty: z.number().min(0).default(0),
});
export const hmiReworkStartSchema = hmiLifecycleCommandSchema.extend({
  reworkRequirementId: idSchema,
});
export const hmiReworkReportSchema = hmiLifecycleCommandSchema.extend({
  quantity: positiveQty,
});
export type HmiLifecycleCommandDto = z.infer<typeof hmiLifecycleCommandSchema>;
export type HmiProductionReportDto = z.infer<typeof hmiProductionReportSchema>;
export type HmiReworkStartDto = z.infer<typeof hmiReworkStartSchema>;
export type HmiReworkReportDto = z.infer<typeof hmiReworkReportSchema>;

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

export const connectorStatusSchema = z.object({
  adapter: z.enum(["simulator", "opcua", "m80", "fanuc"]),
  connectionState: z.enum(["STARTING", "CONNECTED", "DISCONNECTED", "RECONNECTING", "ERROR"]),
  lastSuccessfulCommunicationAt: z.string().datetime().optional(),
  lastErrorCategory: z.enum(["CONNECTION", "BACKEND_DELIVERY", "CONFIGURATION", "ADAPTER", "UNKNOWN"]).optional(),
  reconnecting: z.boolean(),
  configurationValid: z.boolean(),
});
export type ConnectorStatusDto = z.infer<typeof connectorStatusSchema>;

export const controllerObservationSchema = z.object({
  idempotencyKey: z.string().min(8).max(160),
  connectionState: ControllerConnectionStateSchema,
  machineState: ControllerMachineStateSchema,
  trustLevel: ControllerObservationTrustSchema,
  controllerTimestamp: isoDate.optional(),
  activeProgramIdentity: z.string().min(1).max(512).nullable().optional(),
  activeProgramChecksum: z.string().min(1).max(256).nullable().optional(),
  alarmCode: z.string().min(1).max(128).nullable().optional(),
  alarmText: z.string().max(2000).nullable().optional(),
  partCounter: z.number().int().min(0).nullable().optional(),
  connectionGeneration: z.number().int().min(0).default(0),
  capabilities: z.record(ControllerCapabilitySchema, z.boolean()).default({}),
  raw: z.record(z.unknown()).optional(),
});
export type ControllerObservationDto = z.infer<typeof controllerObservationSchema>;
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

// ---- BOM (Faz B, Faz K: çok seviyeli — itemType=PART alt montaj demektir) ----
export const bomLineInputSchema = z.object({
  itemType: StockItemTypeSchema,
  itemId: idSchema,
  qtyPer: positiveQty,
  scrapPct: decimalString.optional(),
  unit: z.string().min(1).max(32).optional(),
  issueMethod: z.enum(["MANUAL_ISSUE", "BACKFLUSH"]).optional().default("MANUAL_ISSUE"),
  consumeOnScrap: z.boolean().optional().default(true),
});
export type BomLineInputDto = z.infer<typeof bomLineInputSchema>;
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
export const engineeringStatusChangeSchema = z.object({ status: EngineeringStatusSchema });
export type EngineeringStatusChangeDto = z.infer<typeof engineeringStatusChangeSchema>;

// ---- Recipe (Faz F) — süreç reçetesi versiyonlama, BomHeader ile aynı desen ----
export const recipeStepInputSchema = z.object({
  /// Upsert eşleştirme anahtarı — mevcut adım güncellenirken gönderilir; yoksa yeni adım oluşturulur.
  id: idSchema.optional(),
  seq: z.number().int().min(1),
  name: z.string().min(1),
  parameterName: z.string().optional(),
  parameterValue: z.string().optional(),
  unit: z.string().optional(),
  ncProgramId: idSchema.optional(),
  standardMinutes: z.coerce.number().nonnegative().optional(),
  idealCycleTimeSec: z.coerce.number().positive().finite().optional(),
  instructionHtml: z.string().optional(),
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

export const createProductionDefinitionSchema = z.object({
  plantId: idSchema,
  partId: idSchema,
  bomHeaderId: idSchema,
  recipeHeaderId: idSchema,
  notes: z.string().max(2000).optional(),
});
export type CreateProductionDefinitionDto = z.infer<typeof createProductionDefinitionSchema>;
export const releaseWorkOrderEngineeringSchema = z.object({
  plantId: idSchema,
  productionDefinitionId: idSchema,
});
export type ReleaseWorkOrderEngineeringDto = z.infer<typeof releaseWorkOrderEngineeringSchema>;

export const createUomDefinitionSchema = z.object({
  code: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9²]+$/),
  name: z.string().trim().min(1).max(120),
  dimension: UomDimensionSchema,
  factorToBase: decimalString,
  decimalPlaces: z.number().int().min(0).max(12).default(6),
});
export type CreateUomDefinitionDto = z.infer<typeof createUomDefinitionSchema>;
export const convertUomSchema = z.object({ fromCode: z.string().min(1).max(32), toCode: z.string().min(1).max(32), quantity: decimalString });
export type ConvertUomDto = z.infer<typeof convertUomSchema>;

export const calendarExceptionInputSchema = z.object({ date: isoDate, isWorking: z.boolean(), name: z.string().max(200).optional() });
export const createPlantProductionCalendarSchema = z.object({
  plantId: idSchema,
  name: z.string().min(1).max(120),
  timezone: z.string().min(1).max(80),
  weeklyWorkingDays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  effectiveFrom: isoDate.optional(), effectiveTo: isoDate.optional(),
  exceptions: z.array(calendarExceptionInputSchema).default([]),
});
export type CreatePlantProductionCalendarDto = z.infer<typeof createPlantProductionCalendarSchema>;
export const productionShiftBreakInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(0).max(1439),
}).refine((value) => value.startMinute !== value.endMinute, { message: "Break start and end cannot be equal", path: ["endMinute"] });
export const createProductionShiftSchema = z.object({
  plantId: idSchema, calendarId: idSchema.optional(), code: z.string().min(1).max(32), name: z.string().min(1).max(120),
  startMinute: z.number().int().min(0).max(1439), endMinute: z.number().int().min(0).max(1439),
  effectiveFrom: isoDate.optional(), effectiveTo: isoDate.optional(), isActive: z.boolean().default(true),
  breaks: z.array(productionShiftBreakInputSchema).max(12).default([]),
}).refine((value) => value.startMinute !== value.endMinute, { message: "Shift start and end cannot be equal", path: ["endMinute"] });
export type CreateProductionShiftDto = z.infer<typeof createProductionShiftSchema>;

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

// ---- Downtime/Andon taxonomy ----
export const createDowntimeReasonSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  category: DowntimeReasonCategorySchema.default("UNPLANNED"),
  lossCategory: ProductionLossCategorySchema.optional(),
});
export type CreateDowntimeReasonDto = z.infer<typeof createDowntimeReasonSchema>;
export const updateDowntimeReasonSchema = createDowntimeReasonSchema.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateDowntimeReasonDto = z.infer<typeof updateDowntimeReasonSchema>;
export const startDowntimeSchema = z.object({
  machineId: idSchema,
  reasonId: idSchema.optional(),
  note: z.string().optional(),
});
export type StartDowntimeDto = z.infer<typeof startDowntimeSchema>;
export const classifyDowntimeSchema = z.object({ reasonId: idSchema });
export type ClassifyDowntimeDto = z.infer<typeof classifyDowntimeSchema>;
export const endDowntimeSchema = z.object({
  reasonId: idSchema.optional(),
  note: z.string().optional(),
});
export type EndDowntimeDto = z.infer<typeof endDowntimeSchema>;

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
/// AHK-006: satın alma/üretim önerisi kararı da bir ApprovalRequest kararıdır —
/// aynı reauth zorunluluğu (bkz. decideCapaSchema notu).
export const mrpProposalDecisionSchema = z.object({
  note: z.string().optional(),
  supplierId: idSchema.optional(),
  password: z.string().min(1),
});
export type MrpProposalDecisionDto = z.infer<typeof mrpProposalDecisionSchema>;

// ---- CNC-V1-03R daily MRP ----
export const runDailyMrpSchema = z.object({
  plantId: idSchema,
  planningDate: isoDate,
  horizonEnd: isoDate,
}).refine((value) => value.horizonEnd >= value.planningDate, { message: "Planning horizon cannot end before its planning date", path: ["horizonEnd"] });
export type RunDailyMrpDto = z.infer<typeof runDailyMrpSchema>;

export const mrpPlanningParameterSchema = z.object({
  plantId: idSchema,
  itemType: StockItemTypeSchema,
  itemId: idSchema,
  planningEnabled: z.boolean().default(true),
  policy: MrpPlanningPolicySchema,
  leadTimeWorkingDays: z.number().int().min(0).max(3650).default(0),
  lotSizingRule: MrpLotSizingRuleSchema.default("LOT_FOR_LOT"),
  minimumQuantity: positiveQty.optional(),
  maximumQuantity: positiveQty.optional(),
  orderMultiple: positiveQty.optional(),
  fixedLotSize: positiveQty.optional(),
  safetyStock: nonNegative.default(0),
  planningHorizonDays: z.number().int().min(1).max(3650).optional(),
  rescheduleToleranceDays: z.number().int().min(0).max(365).default(1),
}).superRefine((value, ctx) => {
  if (value.maximumQuantity && value.minimumQuantity && value.maximumQuantity < value.minimumQuantity) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Maximum quantity cannot be lower than minimum quantity", path: ["maximumQuantity"] });
  if (value.lotSizingRule === "ORDER_MULTIPLE" && !value.orderMultiple) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Order multiple is required", path: ["orderMultiple"] });
  if (value.lotSizingRule === "FIXED_LOT_SIZE" && !value.fixedLotSize) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Fixed lot size is required", path: ["fixedLotSize"] });
});
export type MrpPlanningParameterDto = z.infer<typeof mrpPlanningParameterSchema>;

export const createMrpIndependentDemandSchema = z.object({
  plantId: idSchema,
  itemType: StockItemTypeSchema,
  itemId: idSchema,
  quantity: positiveQty,
  requiredDate: isoDate,
  reference: z.string().trim().max(300).optional(),
});
export type CreateMrpIndependentDemandDto = z.infer<typeof createMrpIndependentDemandSchema>;
