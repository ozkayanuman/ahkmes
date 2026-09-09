import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { InventoryMovementType } from "@prisma/client";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { PartsService } from "../src/parts/parts.service";
import { BomService } from "../src/mrp/bom.service";
import { RecipesService } from "../src/recipes/recipes.service";
import { ProductionDefinitionsService } from "../src/production-definitions/production-definitions.service";
import { WorkOrdersService } from "../src/work-orders/work-orders.service";
import { QualityPlansService } from "../src/quality-plans/quality-plans.service";
import { QualityExecutionService } from "../src/quality-execution/quality-execution.service";
import { InventoryService } from "../src/inventory/inventory.service";
import { ProductionMaterialService } from "../src/production-material/production-material.service";

const stamp = Date.now();
describe("CNC-V1-06 production quality execution (PostgreSQL e2e)", () => {
  let app: INestApplication; let prisma: PrismaService; let parts: PartsService; let boms: BomService; let recipes: RecipesService; let definitions: ProductionDefinitionsService; let workOrders: WorkOrdersService; let plans: QualityPlansService; let quality: QualityExecutionService; let inventory: InventoryService; let materials: ProductionMaterialService;
  let tenantId: string; let adminId: string; let operatorId: string; let plantId: string; let binId: string; let partId: string; let rawId: string;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile(); app = module.createNestApplication(); await app.init();
    prisma = app.get(PrismaService); parts = app.get(PartsService); boms = app.get(BomService); recipes = app.get(RecipesService); definitions = app.get(ProductionDefinitionsService); workOrders = app.get(WorkOrdersService); plans = app.get(QualityPlansService); quality = app.get(QualityExecutionService); inventory = app.get(InventoryService); materials = app.get(ProductionMaterialService);
    tenantId = `cnc-v1-06-${stamp}`; await prisma.tenant.create({ data: { id: tenantId, name: "CNC Quality E2E", timezone: "Europe/Istanbul" } });
    adminId = (await prisma.user.create({ data: { tenantId, email: `quality-admin-${stamp}@test.local`, name: "Quality Admin", passwordHash: await bcrypt.hash("TestPassword123!", 10), role: "ADMIN" } })).id;
    operatorId = (await prisma.user.create({ data: { tenantId, email: `quality-operator-${stamp}@test.local`, name: "Operator", passwordHash: await bcrypt.hash("TestPassword123!", 10), role: "OPERATOR" } })).id;
    plantId = (await prisma.plant.create({ data: { tenantId, name: "Ankara", timezone: "Europe/Istanbul" } })).id;
    const warehouse = await prisma.warehouse.create({ data: { tenantId, name: "Quality WH", code: `Q${stamp}` } }); binId = (await prisma.bin.create({ data: { tenantId, warehouseId: warehouse.id, code: "Q1" } })).id;
    rawId = (await prisma.material.create({ data: { tenantId, code: `Q-RAW-${stamp}`, name: "Quality Raw", type: "RAW", unit: "EA" } })).id;
    partId = (await parts.create(tenantId, { partNo: `P-100-${stamp}`, revision: "A", name: "Quality Part", unit: "EA" })).id;
    await parts.setEngineeringStatus(tenantId, adminId, partId, { status: "RELEASED" });
  });
  afterAll(async () => app.close());

  async function releasedPlan(revision: string, upperLimit: number, status: "RELEASED" | "DRAFT" = "RELEASED") {
    const plan = await plans.create(tenantId, adminId, { name: `P100 Quality ${stamp}`, revision, partId, samplingMethod: "FIXED_COUNT", sampleCount: 2, checks: [
      { seq: 1, checkpointName: "DIAMETER", unit: "MM", lowerLimit: 9.98, upperLimit, requiresMeasurement: true, characteristicType: "NUMERIC", nominalValue: 10.00, isRequired: true },
      { seq: 2, checkpointName: "SURFACE_OK", characteristicType: "BOOLEAN", qualitativeExpected: "PASS", isRequired: true },
    ] });
    if (status === "RELEASED") await plans.setStatus(tenantId, adminId, plan.id, "RELEASED"); return plan;
  }
  async function releasedWo(quantity = 10) {
    const bom = await boms.create(tenantId, { partId, revision: `B-${Math.random()}`, lines: [{ itemType: "MATERIAL", itemId: rawId, qtyPer: 1, unit: "EA", issueMethod: "MANUAL_ISSUE", consumeOnScrap: true }] });
    const routing = await recipes.create(tenantId, { partId, revision: `R-${Math.random()}`, steps: [{ seq: 1, name: "OP10 machining" }] });
    await boms.setStatus(tenantId, adminId, bom.id, { status: "RELEASED" }); await recipes.setStatus(tenantId, adminId, routing.id, { status: "RELEASED" });
    const definition = await definitions.create(tenantId, adminId, { plantId, partId, bomHeaderId: bom.id, recipeHeaderId: routing.id }); await definitions.setStatus(tenantId, adminId, definition.id, { status: "RELEASED" });
    const wo = await workOrders.create(tenantId, { partId, plantId, quantity, dueDate: new Date("2026-11-01"), priority: 5 }); return workOrders.releaseEngineering(tenantId, adminId, wo.id, { plantId, productionDefinitionId: definition.id });
  }
  async function outputLot(woId: string, qty = 10) {
    const lot = await prisma.lot.create({ data: { tenantId, lotNo: `OUT-${Math.random()}-${stamp}`, itemType: "PART", itemId: partId } });
    await prisma.$transaction(tx => inventory.record(tx, { tenantId, itemType: "PART", itemId: partId, lotId: lot.id, binId, quantityDelta: qty, movementType: InventoryMovementType.FINISHED_GOODS_RECEIPT, sourceType: "QUALITY_E2E", sourceId: woId, createdById: adminId })); return lot;
  }
  async function failedLot(woId: string, key: string) {
    const req = await prisma.productionQualityRequirement.findFirstOrThrow({ where: { tenantId, workOrderId: woId } }); const lot = await outputLot(woId); const inspection = await quality.createLot(tenantId, adminId, { requirementId: req.id, lotId: lot.id, idempotencyKey: `lot-${key}-${stamp}` });
    await quality.submitMeasurement(tenantId, adminId, inspection.id, { sampleNo: 1, checkSeq: 1, numericValue: 10.05, unit: "MM", idempotencyKey: `fail-${key}-${stamp}` }); return { lot, inspection: await prisma.inspectionLot.findUniqueOrThrow({ where: { id: inspection.id }, include: { nonConformance: true, holds: true } }) };
  }

  it("passes fixed-count numeric and boolean inspection using the released immutable snapshot", async () => {
    const planA = await releasedPlan("A", 10.02); const wo = await releasedWo(); const req = await prisma.productionQualityRequirement.findFirstOrThrow({ where: { tenantId, workOrderId: wo.id } }); expect(req.planRevision).toBe("A");
    const lot = await quality.createLot(tenantId, adminId, { requirementId: req.id, idempotencyKey: `pass-${stamp}` });
    for (const [sampleNo, value] of [[1, 10.00], [2, 10.01]] as const) { await quality.submitMeasurement(tenantId, adminId, lot.id, { sampleNo, checkSeq: 1, numericValue: value, unit: "MM", idempotencyKey: `pass-d-${sampleNo}-${stamp}` }); await quality.submitMeasurement(tenantId, adminId, lot.id, { sampleNo, checkSeq: 2, resultValue: "PASS", idempotencyKey: `pass-s-${sampleNo}-${stamp}` }); }
    const passed = await prisma.inspectionLot.findUniqueOrThrow({ where: { id: lot.id }, include: { measurements: true, nonConformance: true, holds: true } }); expect(passed.status).toBe("PASSED"); expect(passed.measurements).toHaveLength(4); expect(passed.nonConformance).toBeNull(); expect(passed.holds).toHaveLength(0);
    const planB = await releasedPlan("B", 10.01); const woB = await releasedWo(); expect((await prisma.productionQualityRequirement.findFirstOrThrow({ where: { tenantId, workOrderId: woB.id } })).planRevision).toBe("B"); expect((await prisma.productionQualityRequirement.findUniqueOrThrow({ where: { id: req.id } })).planRevision).toBe("A");
    const draftC = await releasedPlan("C", 10.00, "DRAFT"); const woC = await releasedWo(); expect((await prisma.productionQualityRequirement.findFirstOrThrow({ where: { tenantId, workOrderId: woC.id } })).qualityPlanId).toBe(planB.id); expect(draftC.status).toBe("DRAFT");
  });

  it("holds failed output on hand, rejects canonical reservation and scraps once", async () => {
    const wo = await releasedWo(); const { lot, inspection } = await failedLot(wo.id, "scrap"); expect(inspection.status).toBe("FAILED"); const hold = inspection.holds[0]; expect(hold.quantity?.toString()).toBe("10"); expect(await materials.availability(tenantId, partId, binId, lot.id)).toMatchObject({ onHand: "10", qualityHeld: "10", available: "0" });
    const otherWo = await prisma.workOrder.create({ data: { tenantId, woNo: `QRES-${stamp}`, partId, quantity: 1, dueDate: new Date(), engineeringReleaseRequired: false } }); const materialReq = await prisma.productionMaterialRequirement.create({ data: { tenantId, workOrderId: otherWo.id, itemType: "PART", itemId: partId, unit: "EA", requiredQty: 1, snapshotLine: {} } });
    await expect(materials.reserve(tenantId, adminId, { requirementId: materialReq.id, binId, lotId: lot.id, quantity: 1, idempotencyKey: `held-res-${stamp}` })).rejects.toThrow("quality hold");
    const ncId = inspection.nonConformanceId!; const disposition = await quality.disposition(tenantId, adminId, ncId, { type: "SCRAP", quantity: 10, reason: "Out of tolerance", idempotencyKey: `scrap-${stamp}` }, true); const retry = await quality.disposition(tenantId, adminId, ncId, { type: "SCRAP", quantity: 10, reason: "Out of tolerance", idempotencyKey: `scrap-${stamp}` }, true); expect(retry.id).toBe(disposition.id);
    expect(await prisma.inventoryMovement.count({ where: { tenantId, sourceId: ncId, movementType: "QUALITY_SCRAP" } })).toBe(1); expect((await prisma.stockBalance.findFirstOrThrow({ where: { tenantId, lotId: lot.id } })).qty.toString()).toBe("0"); expect(await prisma.auditLog.count({ where: { tenantId, entityId: disposition.id } })).toBeGreaterThan(0);
  });

  it("denies operator USE_AS_IS, requires explicit release, and creates one pending rework requirement", async () => {
    const wo = await releasedWo(); const failed = await failedLot(wo.id, "use-as-is"); const ncId = failed.inspection.nonConformanceId!; await expect(quality.disposition(tenantId, operatorId, ncId, { type: "USE_AS_IS", reason: "operator tries", idempotencyKey: `uai-denied-${stamp}` }, false)).rejects.toThrow("NCR_USE_AS_IS_APPROVE");
    await quality.disposition(tenantId, adminId, ncId, { type: "USE_AS_IS", reason: "Authorized deviation", idempotencyKey: `uai-${stamp}` }, true); const hold = failed.inspection.holds[0]; const released = await quality.release(tenantId, adminId, hold.id, { reason: "Approved use as is", idempotencyKey: `release-${stamp}` }); expect(released.status).toBe("RELEASED"); expect((await quality.release(tenantId, adminId, hold.id, { reason: "retry", idempotencyKey: `release-retry-${stamp}` })).id).toBe(hold.id);
    const reworkWo = await releasedWo(); const rework = await failedLot(reworkWo.id, "rework"); const reworkNc = rework.inspection.nonConformanceId!; const r = await quality.disposition(tenantId, adminId, reworkNc, { type: "REWORK", quantity: 3, reason: "Re-machine", idempotencyKey: `rework-${stamp}` }, true); expect((await quality.disposition(tenantId, adminId, reworkNc, { type: "REWORK", quantity: 3, reason: "retry", idempotencyKey: `rework-${stamp}` }, true)).id).toBe(r.id); const pending = await prisma.reworkRequirement.findMany({ where: { tenantId, nonConformanceId: reworkNc } }); expect(pending).toHaveLength(1); expect(pending[0]).toMatchObject({ workOrderId: reworkWo.id, quantity: expect.anything(), status: "OPEN" }); await expect(quality.release(tenantId, adminId, rework.inspection.holds[0].id, { reason: "cannot release", idempotencyKey: `bad-release-${stamp}` })).rejects.toThrow("QUALITY_DISPOSITION_REQUIRED");
  });

  it("serializes conflicting terminal dispositions and tenant references", async () => {
    const wo = await releasedWo(); const failed = await failedLot(wo.id, "race"); const ncId = failed.inspection.nonConformanceId!;
    const settled = await Promise.allSettled([quality.disposition(tenantId, adminId, ncId, { type: "SCRAP", quantity: 10, reason: "scrap", idempotencyKey: `race-s-${stamp}` }, true), quality.disposition(tenantId, adminId, ncId, { type: "USE_AS_IS", reason: "use", idempotencyKey: `race-u-${stamp}` }, true)]); expect(settled.filter(x => x.status === "fulfilled")).toHaveLength(1); expect(await prisma.qualityDisposition.count({ where: { tenantId, nonConformanceId: ncId } })).toBe(1);
    const tenantB = `quality-b-${stamp}`; await prisma.tenant.create({ data: { id: tenantB, name: "B", timezone: "Europe/Istanbul" } }); const sourceReq = await prisma.productionQualityRequirement.findFirstOrThrow({ where: { tenantId, workOrderId: wo.id } }); await expect(prisma.productionQualityRequirement.create({ data: { tenantId: tenantB, workOrderId: wo.id, qualityPlanId: sourceReq.qualityPlanId, planRevision: "X", inspectionPoint: "FINAL", samplingMethod: "HUNDRED_PERCENT", snapshot: { checks: [] } } })).rejects.toThrow();
  });

  it("rolls back a failed SCRAP disposition without leaving a terminal NCR", async () => {
    const wo = await releasedWo(); const failed = await failedLot(wo.id, "atomic"); const ncId = failed.inspection.nonConformanceId!;
    await expect(quality.disposition(tenantId, adminId, ncId, { type: "SCRAP", quantity: 11, reason: "too much", idempotencyKey: `atomic-${stamp}` }, true)).rejects.toThrow();
    expect(await prisma.qualityDisposition.count({ where: { tenantId, nonConformanceId: ncId } })).toBe(0);
    expect((await prisma.nonConformance.findUniqueOrThrow({ where: { id: ncId } })).status).toBe("OPEN");
    expect((await prisma.inspectionLot.findUniqueOrThrow({ where: { id: failed.inspection.id } })).status).toBe("FAILED");
  });
});
