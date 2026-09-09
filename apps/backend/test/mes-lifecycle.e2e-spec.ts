import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { PartsService } from "../src/parts/parts.service";
import { BomService } from "../src/mrp/bom.service";
import { RecipesService } from "../src/recipes/recipes.service";
import { ProductionDefinitionsService } from "../src/production-definitions/production-definitions.service";
import { WorkOrdersService } from "../src/work-orders/work-orders.service";
import { ProductionService } from "../src/production/production.service";
import { QualityPlansService } from "../src/quality-plans/quality-plans.service";
import { QualityExecutionService } from "../src/quality-execution/quality-execution.service";
import { ProductionMaterialService } from "../src/production-material/production-material.service";
import { InventoryService } from "../src/inventory/inventory.service";
import { InventoryMovementType } from "@prisma/client";

const stamp = Date.now();

describe("CNC-V1-04 controlled MES lifecycle (PostgreSQL e2e)", () => {
  let app: INestApplication; let prisma: PrismaService; let parts: PartsService; let boms: BomService; let recipes: RecipesService; let definitions: ProductionDefinitionsService; let workOrders: WorkOrdersService; let production: ProductionService; let plans: QualityPlansService; let quality: QualityExecutionService; let materials: ProductionMaterialService; let inventory: InventoryService;
  let tenantId: string; let userId: string; let plantId: string; let partId: string; let rawId: string; let binId: string;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile(); app = module.createNestApplication(); await app.init();
    prisma = app.get(PrismaService); parts = app.get(PartsService); boms = app.get(BomService); recipes = app.get(RecipesService); definitions = app.get(ProductionDefinitionsService); workOrders = app.get(WorkOrdersService); production = app.get(ProductionService); plans = app.get(QualityPlansService); quality = app.get(QualityExecutionService); materials = app.get(ProductionMaterialService); inventory = app.get(InventoryService);
    tenantId = `cnc-v1-04-${stamp}`; await prisma.tenant.create({ data: { id: tenantId, name: "Lifecycle E2E", timezone: "Europe/Istanbul" } });
    userId = (await prisma.user.create({ data: { tenantId, email: `lifecycle-${stamp}@test.local`, name: "Lifecycle Admin", passwordHash: await bcrypt.hash("TestPassword123!", 10), role: "ADMIN" } })).id;
    plantId = (await prisma.plant.create({ data: { tenantId, name: "Ankara", timezone: "Europe/Istanbul" } })).id;
    const warehouse = await prisma.warehouse.create({ data: { tenantId, name: "Lifecycle WH", code: `L${stamp}` } }); binId = (await prisma.bin.create({ data: { tenantId, warehouseId: warehouse.id, code: "L1" } })).id;
    rawId = (await prisma.material.create({ data: { tenantId, code: `RAW-${stamp}`, name: "Raw", type: "RAW", unit: "EA" } })).id;
    partId = (await parts.create(tenantId, { partNo: `P-${stamp}`, revision: "A", name: "Lifecycle Part", unit: "EA" })).id;
    await parts.setEngineeringStatus(tenantId, userId, partId, { status: "RELEASED" });
  });
  afterAll(async () => app.close());

  async function wo(quantity = 10, options: { machineId?: string; ncProgramId?: string } = {}) {
    const bom = await boms.create(tenantId, { partId, revision: `B-${Math.random()}`, lines: [{ itemType: "MATERIAL", itemId: rawId, qtyPer: 1, unit: "EA", issueMethod: "MANUAL_ISSUE", consumeOnScrap: true }] });
    const routing = await recipes.create(tenantId, { partId, revision: `R-${Math.random()}`, steps: [{ seq: 1, name: "OP10", ...(options.ncProgramId ? { ncProgramId: options.ncProgramId } : {}) }] });
    await boms.setStatus(tenantId, userId, bom.id, { status: "RELEASED" }); await recipes.setStatus(tenantId, userId, routing.id, { status: "RELEASED" });
    const definition = await definitions.create(tenantId, userId, { plantId, partId, bomHeaderId: bom.id, recipeHeaderId: routing.id }); await definitions.setStatus(tenantId, userId, definition.id, { status: "RELEASED" });
    const created = await workOrders.create(tenantId, { partId, plantId, quantity, dueDate: new Date("2026-12-01"), priority: 5, ...(options.machineId ? { machineId: options.machineId } : {}) }); const released = await workOrders.releaseEngineering(tenantId, userId, created.id, { plantId, productionDefinitionId: definition.id });
    const requirement = await materials.requirements(tenantId, released.id).then((items) => items[0]);
    await prisma.$transaction((tx) => inventory.record(tx, { tenantId, itemType: "MATERIAL", itemId: rawId, binId, quantityDelta: quantity, movementType: InventoryMovementType.OPENING_BALANCE, sourceType: "LIFECYCLE_E2E", sourceId: released.id, createdById: userId }));
    const reservation = await materials.reserve(tenantId, userId, { requirementId: requirement.id, binId, quantity, idempotencyKey: `reserve-${released.id}` });
    await materials.execute(tenantId, userId, "issue", { requirementId: requirement.id, reservationId: reservation.id, quantity, idempotencyKey: `issue-${released.id}` });
    return released;
  }

  it("persists READY → SETUP → RUNNING → PAUSED → RUNNING → COMPLETE with delta-safe reports", async () => {
    const order = await wo(); const op = order.operations[0];
    await production.setupStart(tenantId, userId, op.id, { idempotencyKey: `setup-start-${stamp}` }); await production.setupComplete(tenantId, userId, op.id, { idempotencyKey: `setup-end-${stamp}` });
    await production.start(tenantId, userId, order.id, { operationId: op.id });
    const first = await production.report(tenantId, userId, op.id, { goodQty: 4, scrapQty: 0, idempotencyKey: `report-1-${stamp}` });
    expect((await production.report(tenantId, userId, op.id, { goodQty: 4, scrapQty: 0, idempotencyKey: `report-1-${stamp}` })).id).toBe(first.id);
    await production.pause(tenantId, userId, op.id, { reasonCode: "MACHINE_STOP", idempotencyKey: `pause-${stamp}` }); await production.resume(tenantId, userId, op.id, { idempotencyKey: `resume-${stamp}` });
    await production.report(tenantId, userId, op.id, { goodQty: 3, scrapQty: 1, idempotencyKey: `report-2-${stamp}` }); await production.report(tenantId, userId, op.id, { goodQty: 2, scrapQty: 0, idempotencyKey: `report-3-${stamp}` });
    await production.completeOperation(tenantId, userId, op.id, { idempotencyKey: `complete-${stamp}` }); await production.completeOperation(tenantId, userId, op.id, { idempotencyKey: `complete-${stamp}` });
    const current = await prisma.workOrderOperation.findUniqueOrThrow({ where: { id: op.id } }); expect(current.status).toBe("COMPLETED"); expect(current.completedQty.toString()).toBe("9"); expect(current.scrapQty.toString()).toBe("1");
    expect(await prisma.productionReport.count({ where: { tenantId, operationId: op.id } })).toBe(3); expect(await prisma.productionExecutionEvent.count({ where: { tenantId, operationId: op.id } })).toBeGreaterThanOrEqual(8);
  });

  it("serializes concurrent reports and pause versus completion", async () => {
    const order = await wo(5); const op = order.operations[0]; await production.start(tenantId, userId, order.id, { operationId: op.id });
    const reports = await Promise.allSettled([production.report(tenantId, userId, op.id, { goodQty: 4, scrapQty: 0, idempotencyKey: `race-a-${stamp}` }), production.report(tenantId, userId, op.id, { goodQty: 4, scrapQty: 0, idempotencyKey: `race-b-${stamp}` })]); expect(reports.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const other = await wo(1); const op2 = other.operations[0]; await production.start(tenantId, userId, other.id, { operationId: op2.id }); await production.report(tenantId, userId, op2.id, { goodQty: 1, scrapQty: 0, idempotencyKey: `race-full-${stamp}` });
    const transitions = await Promise.allSettled([production.pause(tenantId, userId, op2.id, { reasonCode: "MACHINE_STOP", idempotencyKey: `race-pause-${stamp}` }), production.completeOperation(tenantId, userId, op2.id, { idempotencyKey: `race-complete-${stamp}` })]); expect(transitions.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const state = await prisma.workOrderOperation.findUniqueOrThrow({ where: { id: op2.id } }); const active = await prisma.productionRun.count({ where: { tenantId, operationId: op2.id, endedAt: null } }); expect(["PAUSED", "COMPLETED"]).toContain(state.status); if (state.status === "COMPLETED") expect(active).toBe(0);
  });

  it("survives service-context recreation with durable run state and events", async () => {
    const order = await wo(2); const op = order.operations[0]; await production.start(tenantId, userId, order.id, { operationId: op.id }); await production.report(tenantId, userId, op.id, { goodQty: 1, scrapQty: 0, idempotencyKey: `restart-report-${stamp}` }); await production.pause(tenantId, userId, op.id, { reasonCode: "BREAK", idempotencyKey: `restart-pause-${stamp}` });
    const module2 = await Test.createTestingModule({ imports: [AppModule] }).compile(); const app2 = module2.createNestApplication(); await app2.init(); const production2 = app2.get(ProductionService); const before = await app2.get(PrismaService).workOrderOperation.findUniqueOrThrow({ where: { id: op.id } }); expect(before.status).toBe("PAUSED"); expect(before.completedQty.toString()).toBe("1"); expect(await app2.get(PrismaService).productionExecutionEvent.count({ where: { tenantId, operationId: op.id } })).toBeGreaterThan(2); await production2.resume(tenantId, userId, op.id, { idempotencyKey: `restart-resume-${stamp}` }); await app2.close();
  });

  it("executes NCR rework once and resolves only from a new passing reinspection", async () => {
    const plan = await plans.create(tenantId, userId, { name: `Lifecycle Q ${stamp}`, revision: "A", partId, samplingMethod: "HUNDRED_PERCENT", checks: [{ seq: 1, checkpointName: "DIAMETER", operationSeq: 1, unit: "MM", lowerLimit: 9.98, upperLimit: 10.02, requiresMeasurement: true, characteristicType: "NUMERIC", isRequired: true }] }); await plans.setStatus(tenantId, userId, plan.id, "RELEASED");
    const order = await wo(3); const op = order.operations[0]; await production.start(tenantId, userId, order.id, { operationId: op.id });
    const requirement = await prisma.productionQualityRequirement.findFirstOrThrow({ where: { tenantId, workOrderId: order.id, operationId: op.id } }); const failed = await quality.createLot(tenantId, userId, { requirementId: requirement.id, operationId: op.id, idempotencyKey: `rework-fail-lot-${stamp}` }); await quality.submitMeasurement(tenantId, userId, failed.id, { sampleNo: 1, checkSeq: 1, numericValue: 10.05, unit: "MM", idempotencyKey: `rework-fail-measurement-${stamp}` });
    const failure = await prisma.inspectionLot.findUniqueOrThrow({ where: { id: failed.id }, include: { nonConformance: true, holds: true } }); const ncId = failure.nonConformanceId!;
    await expect(production.completeOperation(tenantId, userId, op.id, { idempotencyKey: `blocked-complete-${stamp}` })).rejects.toThrow("QUALITY_INSPECTION_REQUIRED");
    await quality.disposition(tenantId, userId, ncId, { type: "REWORK", quantity: 3, reason: "Re-machine", idempotencyKey: `rework-disposition-${stamp}` }, true);
    const rework = await prisma.reworkRequirement.findFirstOrThrow({ where: { tenantId, nonConformanceId: ncId } }); const start = await production.startRework(tenantId, userId, op.id, rework.id, { idempotencyKey: `rework-start-${stamp}` }) as { reinspectionLotId: string };
    const duplicateStart = await production.startRework(tenantId, userId, op.id, rework.id, { idempotencyKey: `rework-start-${stamp}` }); expect(duplicateStart).toBeDefined();
    const attempts = await Promise.allSettled([production.reportRework(tenantId, userId, op.id, 2, { idempotencyKey: `rework-a-${stamp}` }), production.reportRework(tenantId, userId, op.id, 2, { idempotencyKey: `rework-b-${stamp}` })]); expect(attempts.filter((x) => x.status === "fulfilled")).toHaveLength(1); await production.reportRework(tenantId, userId, op.id, 1, { idempotencyKey: `rework-c-${stamp}` });
    expect((await prisma.reworkRequirement.findUniqueOrThrow({ where: { id: rework.id } })).status).toBe("OPEN");
    await quality.submitMeasurement(tenantId, userId, start.reinspectionLotId, { sampleNo: 1, checkSeq: 1, numericValue: 10, unit: "MM", idempotencyKey: `reinspection-pass-${stamp}` });
    const resolved = await prisma.reworkRequirement.findUniqueOrThrow({ where: { id: rework.id } }); expect(resolved.status).toBe("RESOLVED"); expect(resolved.processedQty.toString()).toBe("3"); expect((await prisma.inspectionLot.findUniqueOrThrow({ where: { id: failed.id } })).status).toBe("FAILED"); expect(await prisma.inspectionLot.count({ where: { tenantId, productionRunId: resolved.reworkRunId } })).toBe(1);
    await quality.release(tenantId, userId, failure.holds[0].id, { reason: "Reinspection passed", idempotencyKey: `rework-release-${stamp}` });
  });
  it("fails closed for mismatched, stale and unsupported controller NC evidence, then refreshes after reconnect", async () => {
    const machine = await prisma.machine.create({ data: { tenantId, name: `M80-${stamp}`, model: "M80", controller: "Mitsubishi M80", connectorType: "M80", connectorConfig: { host: "10.0.0.10", port: 683, programIdentityAddress: "9:9:char" }, controllerVerificationRequired: true, controllerFreshnessSeconds: 60 } });
    const foreignTenant = await prisma.tenant.create({ data: { name: `M80 foreign ${stamp}`, timezone: "Europe/Istanbul" } });
    await expect(prisma.machineControllerObservation.create({ data: { tenantId: foreignTenant.id, machineId: machine.id, idempotencyKey: `m80-cross-tenant-${stamp}`, connectionState: "ONLINE", machineState: "IDLE", trustLevel: "OBSERVED" } })).rejects.toThrow();
    const nc = await prisma.ncProgram.create({ data: { tenantId, partId, version: 99, fileName: "P-100-A.NC", fileRef: "P-100-A.NC", storageKey: `${tenantId}/P-100-A.NC`, mimeType: "text/plain", sizeBytes: 32, checksum: "a".repeat(64), checksumAlgorithm: "SHA-256", status: "PUBLISHED", createdById: userId, publishedById: userId, publishedAt: new Date() } });
    const order = await wo(1, { machineId: machine.id, ncProgramId: nc.id }); const op = order.operations[0];
    const evidence = (key: string, program: string | null, extras: Record<string, unknown> = {}) => prisma.machineControllerObservation.create({ data: { tenantId, machineId: machine.id, idempotencyKey: key, connectionState: "ONLINE", machineState: "IDLE", trustLevel: "CONTROLLER_VERIFIED", activeProgramIdentity: program, connectionGeneration: 1, capabilities: { ACTIVE_PROGRAM_IDENTITY_READ: true, ALARM_READ: true }, ...extras } });
    await evidence(`m80-wrong-${stamp}`, "P-100-B.NC");
    await expectControllerCode(production.start(tenantId, userId, order.id, { operationId: op.id }), "CNC_PROGRAM_MISMATCH");
    await evidence(`m80-match-${stamp}`, "P-100-A.NC");
    await production.start(tenantId, userId, order.id, { operationId: op.id });
    await production.pause(tenantId, userId, op.id, { reasonCode: "MACHINE_STOP", idempotencyKey: `m80-pause-${stamp}` });
    await evidence(`m80-reconnect-wrong-${stamp}`, "P-100-B.NC", { connectionGeneration: 2 });
    await expectControllerCode(production.resume(tenantId, userId, op.id, { idempotencyKey: `m80-resume-wrong-${stamp}` }), "CNC_PROGRAM_MISMATCH");
    await prisma.machineControllerObservation.updateMany({ where: { machineId: machine.id }, data: { ingestedAt: new Date(Date.now() - 120_000) } });
    await evidence(`m80-stale-${stamp}`, "P-100-A.NC", { ingestedAt: new Date(Date.now() - 61_000), connectionGeneration: 3 });
    await expectControllerCode(production.resume(tenantId, userId, op.id, { idempotencyKey: `m80-resume-stale-${stamp}` }), "CNC_DATA_STALE");
    await evidence(`m80-unsupported-${stamp}`, null, { capabilities: { ACTIVE_PROGRAM_IDENTITY_READ: false }, connectionGeneration: 4 });
    await expectControllerCode(production.resume(tenantId, userId, op.id, { idempotencyKey: `m80-resume-unsupported-${stamp}` }), "CNC_PROGRAM_UNVERIFIED");
    await evidence(`m80-refreshed-${stamp}`, "P-100-A.NC", { connectionGeneration: 5 });
    await production.resume(tenantId, userId, op.id, { idempotencyKey: `m80-resume-match-${stamp}` });
  });
});

async function expectControllerCode(value: Promise<unknown>, code: string) {
  try { await value; throw new Error("Expected controller gate rejection"); }
  catch (error) { expect((error as { getResponse?: () => unknown }).getResponse?.()).toMatchObject({ errorCode: code }); }
}
