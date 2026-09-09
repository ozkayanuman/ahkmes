import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { InventoryService } from "../src/inventory/inventory.service";
import { ProductionMaterialService } from "../src/production-material/production-material.service";
import { PartsService } from "../src/parts/parts.service";
import { BomService } from "../src/mrp/bom.service";
import { RecipesService } from "../src/recipes/recipes.service";
import { ProductionDefinitionsService } from "../src/production-definitions/production-definitions.service";
import { WorkOrdersService } from "../src/work-orders/work-orders.service";
import { ProductionService } from "../src/production/production.service";
import { FinishedGoodsService } from "../src/finished-goods/finished-goods.service";
import { InventoryMovementType } from "@prisma/client";

const stamp = Date.now();

describe("CNC-V1-02 production material execution (PostgreSQL e2e)", () => {
  let app: INestApplication; let prisma: PrismaService; let inventory: InventoryService; let materials: ProductionMaterialService;
  let parts: PartsService; let boms: BomService; let recipes: RecipesService; let definitions: ProductionDefinitionsService; let workOrders: WorkOrdersService; let production: ProductionService; let finished: FinishedGoodsService;
  let tenantId: string; let userId: string; let plantId: string; let binId: string; let partId: string; let rawA: string; let rawB: string; let lotA1: string; let lotA2: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile(); app = module.createNestApplication(); await app.init();
    prisma = app.get(PrismaService); inventory = app.get(InventoryService); materials = app.get(ProductionMaterialService); parts = app.get(PartsService); boms = app.get(BomService); recipes = app.get(RecipesService); definitions = app.get(ProductionDefinitionsService); workOrders = app.get(WorkOrdersService); production = app.get(ProductionService); finished = app.get(FinishedGoodsService);
    tenantId = `cnc-v1-02-${stamp}`;
    await prisma.tenant.create({ data: { id: tenantId, name: "CNC V1-02 Test", timezone: "Europe/Istanbul" } });
    userId = (await prisma.user.create({ data: { tenantId, email: `cnc-v1-02-${stamp}@test.local`, name: "Planner", passwordHash: await bcrypt.hash("TestPassword123!", 10), role: "ADMIN" } })).id;
    plantId = (await prisma.plant.create({ data: { tenantId, name: "Ankara", timezone: "Europe/Istanbul" } })).id;
    const warehouse = await prisma.warehouse.create({ data: { tenantId, name: "Raw Store", code: `RAW${stamp}` } }); binId = (await prisma.bin.create({ data: { tenantId, warehouseId: warehouse.id, code: "A1" } })).id;
    rawA = (await prisma.material.create({ data: { tenantId, code: `RAW-A-${stamp}`, name: "Raw A", type: "RAW", unit: "KG", lotTrackingRequired: true } })).id;
    rawB = (await prisma.material.create({ data: { tenantId, code: `RAW-B-${stamp}`, name: "Raw B", type: "RAW", unit: "EA" } })).id;
    lotA1 = (await prisma.lot.create({ data: { tenantId, lotNo: `A1-${stamp}`, itemType: "MATERIAL", itemId: rawA } })).id;
    lotA2 = (await prisma.lot.create({ data: { tenantId, lotNo: `A2-${stamp}`, itemType: "MATERIAL", itemId: rawA } })).id;
    await prisma.$transaction(async tx => {
      await inventory.record(tx, { tenantId, itemType: "MATERIAL", itemId: rawA, lotId: lotA1, binId, quantityDelta: 20, movementType: InventoryMovementType.OPENING_BALANCE, sourceType: "E2E", sourceId: "raw-a1", createdById: userId });
      await inventory.record(tx, { tenantId, itemType: "MATERIAL", itemId: rawA, lotId: lotA2, binId, quantityDelta: 10, movementType: InventoryMovementType.OPENING_BALANCE, sourceType: "E2E", sourceId: "raw-a2", createdById: userId });
      await inventory.record(tx, { tenantId, itemType: "MATERIAL", itemId: rawB, binId, quantityDelta: 20, movementType: InventoryMovementType.OPENING_BALANCE, sourceType: "E2E", sourceId: "raw-b", createdById: userId });
    });
    partId = (await parts.create(tenantId, { partNo: `P-100-${stamp}`, revision: "A", name: "Machined Part", unit: "EA" })).id;
  });
  afterAll(async () => app.close());

  async function releaseWo(quantity: number) {
    const bom = await boms.create(tenantId, { partId, revision: `A-${quantity}-${Math.random()}`, lines: [
      { itemType: "MATERIAL", itemId: rawA, qtyPer: 2.5, unit: "KG", issueMethod: "BACKFLUSH", consumeOnScrap: true },
      { itemType: "MATERIAL", itemId: rawB, qtyPer: 1, unit: "EA", issueMethod: "MANUAL_ISSUE", consumeOnScrap: true },
    ] });
    const routing = await recipes.create(tenantId, { partId, revision: `A-${quantity}-${Math.random()}`, steps: [{ seq: 1, name: "Machining", standardMinutes: 10 }] });
    await parts.setEngineeringStatus(tenantId, userId, partId, { status: "RELEASED" }); await boms.setStatus(tenantId, userId, bom.id, { status: "RELEASED" }); await recipes.setStatus(tenantId, userId, routing.id, { status: "RELEASED" });
    const definition = await definitions.create(tenantId, userId, { plantId, partId, bomHeaderId: bom.id, recipeHeaderId: routing.id }); await definitions.setStatus(tenantId, userId, definition.id, { status: "RELEASED" });
    const wo = await workOrders.create(tenantId, { partId, plantId, quantity, dueDate: new Date("2026-10-01"), priority: 5 });
    return workOrders.releaseEngineering(tenantId, userId, wo.id, { plantId, productionDefinitionId: definition.id });
  }

  it("uses immutable requirements, reserves by lot, issues, backflushes deltas and exposes input genealogy", async () => {
    const wo = await releaseWo(10); const requirements = await materials.requirements(tenantId, wo.id); const reqA = requirements.find(x => x.itemId === rawA)!; const reqB = requirements.find(x => x.itemId === rawB)!;
    expect(reqA.requiredQty.toString()).toBe("25"); expect(reqB.requiredQty.toString()).toBe("10");
    const rA1 = await materials.reserve(tenantId, userId, { requirementId: reqA.id, binId, lotId: lotA1, quantity: 20, idempotencyKey: `a1-${stamp}` });
    const rA2 = await materials.reserve(tenantId, userId, { requirementId: reqA.id, binId, lotId: lotA2, quantity: 5, idempotencyKey: `a2-${stamp}` });
    const rB = await materials.reserve(tenantId, userId, { requirementId: reqB.id, binId, quantity: 10, idempotencyKey: `b-${stamp}` });
    expect(await materials.availability(tenantId, rawA)).toMatchObject({ onHand: "30", reserved: "25", available: "5" });
    await materials.execute(tenantId, userId, "issue", { requirementId: reqA.id, reservationId: rA1.id, quantity: 20, idempotencyKey: `issue-a1-${stamp}` });
    await materials.execute(tenantId, userId, "issue", { requirementId: reqA.id, reservationId: rA2.id, quantity: 5, idempotencyKey: `issue-a2-${stamp}` });
    await materials.execute(tenantId, userId, "issue", { requirementId: reqB.id, reservationId: rB.id, quantity: 10, idempotencyKey: `issue-b-${stamp}` });
    const run1 = await production.start(tenantId, userId, wo.id, { operationId: wo.operations[0].id }); await production.complete(tenantId, run1.id, { goodCount: 4, scrapCount: 1 });
    let afterFirst = await materials.requirements(tenantId, wo.id); expect(afterFirst.find(x => x.id === reqA.id)!.consumedQty.toString()).toBe("12.5");
    const run2 = await production.start(tenantId, userId, wo.id, { operationId: wo.operations[0].id }); await production.complete(tenantId, run2.id, { goodCount: 5, scrapCount: 0 });
    afterFirst = await materials.requirements(tenantId, wo.id); expect(afterFirst.find(x => x.id === reqA.id)!.consumedQty.toString()).toBe("25");
    await materials.execute(tenantId, userId, "consume", { requirementId: reqB.id, quantity: 9, idempotencyKey: `consume-b-${stamp}` });
    await materials.execute(tenantId, userId, "scrap", { requirementId: reqB.id, quantity: 1, reasonCode: "CUTTING_LOSS", idempotencyKey: `scrap-b-${stamp}` });
    await finished.create(tenantId, userId, { workOrderId: wo.id, quantity: 9, binId });
    const duplicate = await materials.execute(tenantId, userId, "consume", { requirementId: reqB.id, quantity: 9, idempotencyKey: `consume-b-${stamp}` }); expect(duplicate.id).toBeDefined();
    const genealogy = await workOrders.genealogy(tenantId, wo.id); expect(JSON.stringify(genealogy)).toContain(`A1-${stamp}`); expect(JSON.stringify(genealogy)).toContain(`A2-${stamp}`);
  });

  it("serializes competing PostgreSQL reservations so they cannot over-allocate stock", async () => {
    const rawX = (await prisma.material.create({ data: { tenantId, code: `RAW-X-${stamp}`, name: "Race stock", type: "RAW", unit: "KG" } })).id;
    await prisma.$transaction(tx => inventory.record(tx, { tenantId, itemType: "MATERIAL", itemId: rawX, binId, quantityDelta: 10, movementType: InventoryMovementType.OPENING_BALANCE, sourceType: "E2E", sourceId: "race", createdById: userId }));
    const attempts = ["a", "b"].map(async suffix => {
      const wo = await prisma.workOrder.create({ data: { tenantId, woNo: `RACE-${suffix}-${stamp}`, partId, quantity: 1, dueDate: new Date(), engineeringReleaseRequired: false } });
      const requirement = await prisma.productionMaterialRequirement.create({ data: { tenantId, workOrderId: wo.id, itemType: "MATERIAL", itemId: rawX, unit: "KG", requiredQty: 8, snapshotLine: {} } });
      return materials.reserve(tenantId, userId, { requirementId: requirement.id, binId, quantity: 8, idempotencyKey: `race-${suffix}-${stamp}` });
    });
    const settled = await Promise.allSettled(attempts); const fulfilled = settled.filter(x => x.status === "fulfilled"); expect(fulfilled).toHaveLength(1);
    expect(await materials.availability(tenantId, rawX)).toMatchObject({ onHand: "10", reserved: "8", available: "2" });
  });
});
