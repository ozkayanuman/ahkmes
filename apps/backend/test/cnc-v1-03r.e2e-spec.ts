import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import * as bcrypt from "bcryptjs";
import { InventoryMovementType } from "@prisma/client";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { MrpService } from "../src/mrp/mrp.service";
import { BomService } from "../src/mrp/bom.service";
import { InventoryService } from "../src/inventory/inventory.service";
import { PartsService } from "../src/parts/parts.service";
import { RecipesService } from "../src/recipes/recipes.service";
import { ProductionDefinitionsService } from "../src/production-definitions/production-definitions.service";
import { WorkOrdersService } from "../src/work-orders/work-orders.service";
import { ProductionMaterialService } from "../src/production-material/production-material.service";
import { SalesOrdersService } from "../src/sales-orders/sales-orders.service";
import { MrpRunSynchronization } from "../src/mrp/mrp-run-synchronization";

const stamp = Date.now();
const PLANNING_DATE = new Date("2026-08-10T09:00:00.000Z");
const MONDAY = new Date("2026-08-17T09:00:00.000Z");
const NEXT_MONDAY = new Date("2026-08-24T09:00:00.000Z");
const HORIZON_END = new Date("2026-09-30T09:00:00.000Z");

type Scenario = {
  tag: string;
  plantId: string;
  binId: string;
  rawId: string;
  fgId: string;
};

jest.setTimeout(60_000);

/**
 * CNC-V1-03R real PostgreSQL release matrix. Every A-W case is separately
 * named so the release gate cannot be inferred from a broad aggregate test.
 * Fixtures use isolated plants/items while exercising the canonical MrpService.
 */
describe("CNC-V1-03R daily MRP release matrix (PostgreSQL e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mrp: MrpService;
  let boms: BomService;
  let inventory: InventoryService;
  let parts: PartsService;
  let recipes: RecipesService;
  let definitions: ProductionDefinitionsService;
  let workOrders: WorkOrdersService;
  let materials: ProductionMaterialService;
  let salesOrders: SalesOrdersService;
  let synchronization: MrpRunSynchronization;
  let tenantId: string;
  let userId: string;
  let sequence = 0;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    mrp = app.get(MrpService);
    boms = app.get(BomService);
    inventory = app.get(InventoryService);
    parts = app.get(PartsService);
    recipes = app.get(RecipesService);
    definitions = app.get(ProductionDefinitionsService);
    workOrders = app.get(WorkOrdersService);
    materials = app.get(ProductionMaterialService);
    salesOrders = app.get(SalesOrdersService);
    synchronization = app.get(MrpRunSynchronization);
    tenantId = `cnc-v1-03r-${stamp}`;
    await prisma.tenant.create({ data: { id: tenantId, name: "CNC V1-03R Test", timezone: "Europe/Istanbul" } });
    userId = (await prisma.user.create({
      data: {
        tenantId,
        email: `cnc-v1-03r-${stamp}@test.local`,
        name: "Planner",
        passwordHash: await bcrypt.hash("TestPassword123!", 10),
        role: "ADMIN",
      },
    })).id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  afterEach(() => jest.restoreAllMocks());

  function deferred() {
    let resolve!: () => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<void>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
    return { promise, resolve, reject };
  }

  function pauseAt(point: "SNAPSHOT_ESTABLISHED" | "PUBLICATION_STAGED") {
    const reached = deferred();
    const resume = deferred();
    jest.spyOn(synchronization, "reached").mockImplementation(async (current) => {
      if (current === point) { reached.resolve(); await resume.promise; }
    });
    return { reached: reached.promise, resume: resume.resolve };
  }

  async function createPlant(tag: string, holiday?: string) {
    const suffix = `${tag}-${++sequence}-${stamp}`;
    const plantId = (await prisma.plant.create({ data: { tenantId, name: `Plant ${suffix}`, timezone: "Europe/Istanbul" } })).id;
    await prisma.plantProductionCalendar.create({
      data: {
        tenantId,
        plantId,
        name: `Weekdays ${suffix}`,
        timezone: "Europe/Istanbul",
        weeklyWorkingDays: [1, 2, 3, 4, 5],
        ...(holiday ? { exceptions: { create: { tenantId, date: new Date(`${holiday}T00:00:00.000Z`), isWorking: false, name: "Holiday" } } } : {}),
      },
    });
    const warehouse = await prisma.warehouse.create({ data: { tenantId, plantId, name: `Store ${suffix}`, code: `W-${suffix}` } });
    const binId = (await prisma.bin.create({ data: { tenantId, warehouseId: warehouse.id, code: "A1" } })).id;
    return { tag: suffix, plantId, binId };
  }

  async function createScenario(tag: string, holiday?: string): Promise<Scenario> {
    const physical = await createPlant(tag, holiday);
    const rawId = (await prisma.material.create({ data: { tenantId, code: `RAW-${physical.tag}`, name: `Raw ${tag}`, type: "RAW", unit: "EA" } })).id;
    const fgId = (await prisma.part.create({ data: { tenantId, partNo: `FG-${physical.tag}`, name: `Finished ${tag}`, unit: "EA" } })).id;
    return { ...physical, rawId, fgId };
  }

  async function createMaterial(tag: string) {
    return (await prisma.material.create({ data: { tenantId, code: `MAT-${tag}-${++sequence}-${stamp}`, name: `Material ${tag}`, type: "RAW", unit: "EA" } })).id;
  }

  async function parameter(
    scenario: Pick<Scenario, "plantId">,
    itemType: "MATERIAL" | "PART",
    itemId: string,
    overrides: Record<string, unknown> = {},
  ) {
    return mrp.upsertPlanningParameter(tenantId, userId, {
      plantId: scenario.plantId,
      itemType,
      itemId,
      policy: itemType === "PART" ? "MAKE" : "BUY",
      leadTimeWorkingDays: 0,
      lotSizingRule: "LOT_FOR_LOT",
      safetyStock: 0,
      planningEnabled: true,
      rescheduleToleranceDays: 1,
      ...overrides,
    });
  }

  function demand(scenario: Pick<Scenario, "plantId">, itemType: "MATERIAL" | "PART", itemId: string, quantity: number, requiredDate = MONDAY) {
    return mrp.createIndependentDemand(tenantId, userId, { plantId: scenario.plantId, itemType, itemId, quantity, requiredDate, reference: `E2E ${quantity}` });
  }

  function run(scenario: Pick<Scenario, "plantId">) {
    return mrp.runDaily(tenantId, userId, { plantId: scenario.plantId, planningDate: PLANNING_DATE, horizonEnd: HORIZON_END });
  }

  async function proposalsForRun(scenario: Pick<Scenario, "plantId">, runId: string) {
    return (await mrp.listDailyProposals(tenantId, { plantId: scenario.plantId })).filter((proposal: any) => proposal.runId === runId);
  }

  async function proposedForItem(scenario: Pick<Scenario, "plantId">, runId: string, itemId: string) {
    return (await proposalsForRun(scenario, runId)).find((proposal: any) => proposal.itemId === itemId && proposal.status === "PROPOSED");
  }

  async function addStock(
    location: Pick<Scenario, "tag" | "binId">,
    itemType: "MATERIAL" | "PART",
    itemId: string,
    quantity: number,
    acceptanceStatus: "PENDING" | "ACCEPTED" | "REJECTED" = "ACCEPTED",
  ) {
    const lot = await prisma.lot.create({
      data: { tenantId, lotNo: `LOT-${location.tag}-${++sequence}`, itemType, itemId, acceptanceStatus },
    });
    await prisma.$transaction((tx) => inventory.record(tx, {
      tenantId,
      itemType,
      itemId,
      lotId: lot.id,
      binId: location.binId,
      quantityDelta: quantity,
      movementType: InventoryMovementType.OPENING_BALANCE,
      sourceType: "CNC_V1_03R_E2E",
      sourceId: lot.id,
      createdById: userId,
    }));
    return lot;
  }

  async function releaseBom(partId: string, revision: string, lines: Array<{ itemType: "MATERIAL" | "PART"; itemId: string; qtyPer: number }>) {
    const bom = await boms.create(tenantId, {
      partId,
      revision,
      lines: lines.map((line) => ({ ...line, unit: "EA", issueMethod: "MANUAL_ISSUE" as const, consumeOnScrap: true })),
    });
    await boms.setStatus(tenantId, userId, bom.id, { status: "RELEASED" });
    return bom;
  }

  async function releaseDefinitionForBom(plantId: string, partId: string, bom: { id: string }, revision: string) {
    const routing = await recipes.create(tenantId, { partId, revision, steps: [{ seq: 1, name: "MRP operation", standardMinutes: 5 }] });
    await parts.setEngineeringStatus(tenantId, userId, partId, { status: "RELEASED" });
    await recipes.setStatus(tenantId, userId, routing.id, { status: "RELEASED" });
    const definition = await definitions.create(tenantId, userId, { plantId, partId, bomHeaderId: bom.id, recipeHeaderId: routing.id });
    await definitions.setStatus(tenantId, userId, definition.id, { status: "RELEASED" });
    return definition;
  }

  async function releasedDefinition(scenario: Scenario, quantityPer = 2) {
    const bom = await boms.create(tenantId, {
      partId: scenario.fgId,
      revision: "A",
      lines: [{ itemType: "MATERIAL", itemId: scenario.rawId, qtyPer: quantityPer, unit: "EA", issueMethod: "MANUAL_ISSUE", consumeOnScrap: true }],
    });
    const routing = await recipes.create(tenantId, { partId: scenario.fgId, revision: "A", steps: [{ seq: 1, name: "Machining", standardMinutes: 5 }] });
    await parts.setEngineeringStatus(tenantId, userId, scenario.fgId, { status: "RELEASED" });
    await boms.setStatus(tenantId, userId, bom.id, { status: "RELEASED" });
    await recipes.setStatus(tenantId, userId, routing.id, { status: "RELEASED" });
    const definition = await definitions.create(tenantId, userId, { plantId: scenario.plantId, partId: scenario.fgId, bomHeaderId: bom.id, recipeHeaderId: routing.id });
    await definitions.setStatus(tenantId, userId, definition.id, { status: "RELEASED" });
    return definition;
  }

  async function buyProposal(tag: string, quantity = 10) {
    const scenario = await createScenario(tag);
    await parameter(scenario, "MATERIAL", scenario.rawId);
    await demand(scenario, "MATERIAL", scenario.rawId, quantity);
    const mrpRun = await run(scenario);
    const proposal = await proposedForItem(scenario, mrpRun.id, scenario.rawId);
    expect(proposal).toBeDefined();
    return { scenario, proposal };
  }

  it("A - nets dated demand in separate receipt buckets with dated pegging", async () => {
    const scenario = await createScenario("A");
    await parameter(scenario, "MATERIAL", scenario.rawId);
    const first = await demand(scenario, "MATERIAL", scenario.rawId, 4, MONDAY);
    const second = await demand(scenario, "MATERIAL", scenario.rawId, 6, NEXT_MONDAY);
    const mrpRun = await run(scenario);
    const proposals = (await proposalsForRun(scenario, mrpRun.id)).filter((item: any) => item.itemId === scenario.rawId);
    expect(proposals.map((item: any) => [item.quantity.toString(), item.receiptDate.toISOString().slice(0, 10)])).toEqual([["4", "2026-08-17"], ["6", "2026-08-24"]]);
    expect(proposals.map((item: any) => item.peggings[0].demandId)).toEqual(expect.arrayContaining([first.id, second.id]));
  });

  it("B - explodes a released two-level BOM to exact dependent requirements", async () => {
    const scenario = await createScenario("B");
    const componentId = (await prisma.part.create({ data: { tenantId, partNo: `COMP-${scenario.tag}`, name: "Component", unit: "EA" } })).id;
    const fgBom = await releaseBom(scenario.fgId, "A", [{ itemType: "PART", itemId: componentId, qtyPer: 2 }]);
    const componentBom = await releaseBom(componentId, "A", [{ itemType: "MATERIAL", itemId: scenario.rawId, qtyPer: 3 }]);
    await releaseDefinitionForBom(scenario.plantId, scenario.fgId, fgBom, "A");
    await releaseDefinitionForBom(scenario.plantId, componentId, componentBom, "A");
    await parameter(scenario, "PART", scenario.fgId);
    await parameter(scenario, "PART", componentId);
    await parameter(scenario, "MATERIAL", scenario.rawId);
    await demand(scenario, "PART", scenario.fgId, 10);
    const mrpRun = await run(scenario);
    const proposals = await proposalsForRun(scenario, mrpRun.id);
    expect(proposals.find((item: any) => item.itemId === scenario.fgId)?.quantity.toString()).toBe("10");
    expect(proposals.find((item: any) => item.itemId === componentId)?.quantity.toString()).toBe("20");
    const raw = proposals.find((item: any) => item.itemId === scenario.rawId);
    expect(raw?.quantity.toString()).toBe("60");
    expect(raw?.peggings[0]).toMatchObject({ demandType: "DEPENDENT_BOM", parentDemandType: "DEPENDENT_BOM" });
  });

  it("B2 - nets subassembly stock before exploding child demand and cascades working-day dates", async () => {
    const scenario = await createScenario("B2");
    const componentId = (await prisma.part.create({ data: { tenantId, partNo: `COMP-${scenario.tag}`, name: "Stocked component", unit: "EA" } })).id;
    const fgBom = await releaseBom(scenario.fgId, "A", [{ itemType: "PART", itemId: componentId, qtyPer: 2 }]);
    const componentBom = await releaseBom(componentId, "A", [{ itemType: "MATERIAL", itemId: scenario.rawId, qtyPer: 3 }]);
    await releaseDefinitionForBom(scenario.plantId, scenario.fgId, fgBom, "A");
    await releaseDefinitionForBom(scenario.plantId, componentId, componentBom, "A");
    await addStock(scenario, "PART", componentId, 8);
    await parameter(scenario, "PART", scenario.fgId, { leadTimeWorkingDays: 2 });
    await parameter(scenario, "PART", componentId, { leadTimeWorkingDays: 2 });
    await parameter(scenario, "MATERIAL", scenario.rawId, { leadTimeWorkingDays: 1 });
    await demand(scenario, "PART", scenario.fgId, 10, MONDAY);
    const mrpRun = await run(scenario);
    const proposals = await proposalsForRun(scenario, mrpRun.id);
    const component = proposals.find((item: any) => item.itemId === componentId);
    const raw = proposals.find((item: any) => item.itemId === scenario.rawId);
    expect(component?.quantity.toString()).toBe("12");
    expect(component?.receiptDate.toISOString().slice(0, 10)).toBe("2026-08-13");
    expect(raw?.quantity.toString()).toBe("36");
    expect(raw?.receiptDate.toISOString().slice(0, 10)).toBe("2026-08-11");
  });

  it("B3 - converts released BOM quantities into the component canonical UOM", async () => {
    const scenario = await createScenario("B3");
    const gramsId = (await prisma.material.create({ data: { tenantId, code: `GRAM-${scenario.tag}`, name: "Powder in grams", type: "RAW", unit: "G" } })).id;
    const bom = await boms.create(tenantId, {
      partId: scenario.fgId,
      revision: "A",
      lines: [{ itemType: "MATERIAL", itemId: gramsId, qtyPer: 2, unit: "KG", issueMethod: "MANUAL_ISSUE", consumeOnScrap: true }],
    });
    await boms.setStatus(tenantId, userId, bom.id, { status: "RELEASED" });
    await releaseDefinitionForBom(scenario.plantId, scenario.fgId, bom, "A");
    await parameter(scenario, "PART", scenario.fgId);
    await parameter(scenario, "MATERIAL", gramsId);
    await demand(scenario, "PART", scenario.fgId, 3);
    const mrpRun = await run(scenario);
    const grams = (await proposalsForRun(scenario, mrpRun.id)).find((item: any) => item.itemId === gramsId);
    expect(grams?.quantity.toString()).toBe("6000");
  });

  it("C - nets canonical on-hand and reservation coverage exactly once", async () => {
    const scenario = await createScenario("C");
    const lot = await addStock(scenario, "MATERIAL", scenario.rawId, 100);
    const definition = await releasedDefinition(scenario, 2);
    const wo = await workOrders.create(tenantId, { partId: scenario.fgId, plantId: scenario.plantId, quantity: 35, dueDate: MONDAY, priority: 5 });
    const released = await workOrders.releaseEngineering(tenantId, userId, wo.id, { plantId: scenario.plantId, productionDefinitionId: definition.id });
    const requirement = (await materials.requirements(tenantId, released.id))[0]!;
    await materials.reserve(tenantId, userId, { requirementId: requirement.id, binId: scenario.binId, lotId: lot.id, quantity: 70, idempotencyKey: `C-reserve-${stamp}` });
    await parameter(scenario, "MATERIAL", scenario.rawId);
    await demand(scenario, "MATERIAL", scenario.rawId, 50);
    const mrpRun = await run(scenario);
    const proposal = await proposedForItem(scenario, mrpRun.id, scenario.rawId);
    expect(proposal?.quantity.toString()).toBe("20");
  });

  it("C2 - plans sales-linked WO components from immutable released requirements", async () => {
    const scenario = await createScenario("C2");
    const definition = await releasedDefinition(scenario, 2);
    const customer = await prisma.customer.create({ data: { tenantId, name: `Customer ${scenario.tag}` } });
    const salesOrder = await prisma.salesOrder.create({ data: { tenantId, soNo: `SO-${scenario.tag}`, customerId: customer.id, createdById: userId } });
    const salesLine = await prisma.salesOrderLine.create({ data: { tenantId, salesOrderId: salesOrder.id, partId: scenario.fgId, quantity: 5, unitPrice: 1, dueDate: MONDAY } });
    const wo = await prisma.workOrder.create({ data: { tenantId, woNo: `IE-${scenario.tag}`, salesOrderLineId: salesLine.id, partId: scenario.fgId, plantId: scenario.plantId, quantity: 5, dueDate: MONDAY, engineeringReleaseRequired: true } });
    await workOrders.releaseEngineering(tenantId, userId, wo.id, { plantId: scenario.plantId, productionDefinitionId: definition.id });
    const requirement = (await materials.requirements(tenantId, wo.id))[0]!;
    expect(requirement.requiredQty.toString()).toBe("10");
    await prisma.bomLine.updateMany({ where: { bomHeaderId: definition.bomHeaderId }, data: { qtyPer: 9 } });
    await parameter(scenario, "MATERIAL", scenario.rawId);
    const mrpRun = await run(scenario);
    const proposal = await proposedForItem(scenario, mrpRun.id, scenario.rawId);
    expect(proposal?.quantity.toString()).toBe("10");
    expect(proposal?.peggings[0]).toMatchObject({ demandId: requirement.id, parentDemandType: "WORK_ORDER", parentDemandId: wo.id });
  });

  it("D - excludes quality-held inventory from usable opening stock", async () => {
    const scenario = await createScenario("D");
    const heldLot = await addStock(scenario, "MATERIAL", scenario.rawId, 80);
    await addStock(scenario, "MATERIAL", scenario.rawId, 20);
    await prisma.qualityHold.create({ data: { tenantId, target: "INVENTORY_LOT", lotId: heldLot.id, quantity: 80, reason: "Inspection hold", source: "E2E", idempotencyKey: `D-hold-${stamp}`, createdById: userId } });
    await parameter(scenario, "MATERIAL", scenario.rawId);
    await demand(scenario, "MATERIAL", scenario.rawId, 50);
    const mrpRun = await run(scenario);
    expect((await proposedForItem(scenario, mrpRun.id, scenario.rawId))?.quantity.toString()).toBe("30");
  });

  it("E - recognizes remaining open work-order output as dated supply", async () => {
    const scenario = await createScenario("E");
    await parameter(scenario, "PART", scenario.fgId);
    await workOrders.create(tenantId, { partId: scenario.fgId, plantId: scenario.plantId, quantity: 10, dueDate: MONDAY, priority: 5 });
    await demand(scenario, "PART", scenario.fgId, 4);
    const mrpRun = await run(scenario);
    const proposal = await proposedForItem(scenario, mrpRun.id, scenario.fgId);
    expect(proposal?.quantity.toString()).toBe("4");
    expect((proposal?.calculation as any).existingSupplyBeforeDate).toBe(10);
  });

  it("F - recognizes only dated open purchase-order supply with plant provenance", async () => {
    const scenario = await createScenario("F");
    const supplier = await prisma.supplier.create({ data: { tenantId, name: `Supplier ${scenario.tag}` } });
    await prisma.purchaseOrder.create({
      data: {
        tenantId,
        poNo: `PO-${scenario.tag}`,
        supplierId: supplier.id,
        plantId: scenario.plantId,
        orderDate: PLANNING_DATE,
        expectedDate: MONDAY,
        createdById: userId,
        lines: { create: { tenantId, materialId: scenario.rawId, quantity: 6, unitPrice: 1 } },
      },
    });
    await parameter(scenario, "MATERIAL", scenario.rawId);
    await demand(scenario, "MATERIAL", scenario.rawId, 10);
    const mrpRun = await run(scenario);
    const proposal = await proposedForItem(scenario, mrpRun.id, scenario.rawId);
    expect(proposal?.quantity.toString()).toBe("4");
    expect((proposal?.calculation as any).existingSupplyBeforeDate).toBe(6);
  });

  it("G - offsets three lead-time days through the canonical working-week calendar", async () => {
    const scenario = await createScenario("G");
    await parameter(scenario, "MATERIAL", scenario.rawId, { leadTimeWorkingDays: 3 });
    await demand(scenario, "MATERIAL", scenario.rawId, 1, MONDAY);
    const mrpRun = await run(scenario);
    expect((await proposedForItem(scenario, mrpRun.id, scenario.rawId))?.releaseDate.toISOString().slice(0, 10)).toBe("2026-08-12");
  });

  it("H - skips an explicit plant holiday during lead-time offset", async () => {
    const scenario = await createScenario("H", "2026-08-14");
    await parameter(scenario, "MATERIAL", scenario.rawId, { leadTimeWorkingDays: 3 });
    await demand(scenario, "MATERIAL", scenario.rawId, 1, MONDAY);
    const mrpRun = await run(scenario);
    expect((await proposedForItem(scenario, mrpRun.id, scenario.rawId))?.releaseDate.toISOString().slice(0, 10)).toBe("2026-08-11");
  });

  it("I - applies explicit plant-item MAKE and BUY policies", async () => {
    const scenario = await createScenario("I");
    const bom = await releaseBom(scenario.fgId, "A", [{ itemType: "MATERIAL", itemId: scenario.rawId, qtyPer: 2 }]);
    await releaseDefinitionForBom(scenario.plantId, scenario.fgId, bom, "A");
    await parameter(scenario, "PART", scenario.fgId, { policy: "MAKE" });
    await parameter(scenario, "MATERIAL", scenario.rawId, { policy: "BUY" });
    await demand(scenario, "PART", scenario.fgId, 3);
    const mrpRun = await run(scenario);
    const proposals = await proposalsForRun(scenario, mrpRun.id);
    expect(proposals.find((item: any) => item.itemId === scenario.fgId)?.policy).toBe("MAKE");
    expect(proposals.find((item: any) => item.itemId === scenario.rawId)?.policy).toBe("BUY");
  });

  it("J - applies lot-for-lot, minimum, order-multiple and fixed-lot rules", async () => {
    const scenario = await createScenario("J");
    const minimumId = await createMaterial("J-minimum");
    const multipleId = await createMaterial("J-multiple");
    const fixedId = await createMaterial("J-fixed");
    await parameter(scenario, "MATERIAL", scenario.rawId, { lotSizingRule: "LOT_FOR_LOT" });
    await parameter(scenario, "MATERIAL", minimumId, { lotSizingRule: "MINIMUM_QUANTITY", minimumQuantity: 10 });
    await parameter(scenario, "MATERIAL", multipleId, { lotSizingRule: "ORDER_MULTIPLE", orderMultiple: 4 });
    await parameter(scenario, "MATERIAL", fixedId, { lotSizingRule: "FIXED_LOT_SIZE", fixedLotSize: 5 });
    for (const itemId of [scenario.rawId, minimumId, multipleId, fixedId]) await demand(scenario, "MATERIAL", itemId, 7);
    const mrpRun = await run(scenario);
    const proposals = await proposalsForRun(scenario, mrpRun.id);
    expect(proposals.find((item: any) => item.itemId === scenario.rawId)?.quantity.toString()).toBe("7");
    expect(proposals.find((item: any) => item.itemId === minimumId)?.quantity.toString()).toBe("10");
    expect(proposals.find((item: any) => item.itemId === multipleId)?.quantity.toString()).toBe("8");
    expect(proposals.find((item: any) => item.itemId === fixedId)?.quantity.toString()).toBe("10");
  });

  it("K - plans the safety-stock deficit after demand and usable stock netting", async () => {
    const scenario = await createScenario("K");
    await addStock(scenario, "MATERIAL", scenario.rawId, 10);
    await parameter(scenario, "MATERIAL", scenario.rawId, { safetyStock: 3 });
    await demand(scenario, "MATERIAL", scenario.rawId, 10);
    const mrpRun = await run(scenario);
    const proposal = await proposedForItem(scenario, mrpRun.id, scenario.rawId);
    expect(proposal?.quantity.toString()).toBe("3");
    expect((proposal?.calculation as any).safetyStock).toBe(3);
  });

  it("L - firms a proposal without changing its calculation, quantity or dates", async () => {
    const { scenario, proposal } = await buyProposal("L", 5);
    const before = await mrp.findDailyProposal(tenantId, proposal.id);
    const firmed = await mrp.firmDailyProposal(tenantId, userId, proposal.id, true);
    expect(firmed).toMatchObject({ status: "FIRMED", firmedById: userId });
    const after = await mrp.findDailyProposal(tenantId, proposal.id);
    expect(after.quantity.toString()).toBe(before.quantity.toString());
    expect(after.receiptDate).toEqual(before.receiptDate);
    expect(after.releaseDate).toEqual(before.releaseDate);
    expect(after.calculation).toEqual(before.calculation);
    expect((await prisma.auditLog.findMany({ where: { tenantId, entity: "mrp-proposal", entityId: proposal.id, action: "STATUS_CHANGE" } }))).toHaveLength(1);
    expect(scenario.plantId).toBe(after.plantId);
  });

  it("M - fully regenerates deterministically while preserving firm supply", async () => {
    const scenario = await createScenario("M");
    await parameter(scenario, "MATERIAL", scenario.rawId);
    await demand(scenario, "MATERIAL", scenario.rawId, 5);
    const firstRun = await run(scenario);
    const first = await proposedForItem(scenario, firstRun.id, scenario.rawId);
    const secondRun = await run(scenario);
    const second = await proposedForItem(scenario, secondRun.id, scenario.rawId);
    expect((await mrp.findDailyProposal(tenantId, first.id)).status).toBe("SUPERSEDED");
    expect(second).toMatchObject({ itemId: first.itemId, policy: first.policy });
    expect(second.quantity.toString()).toBe(first.quantity.toString());
    expect(second.receiptDate).toEqual(first.receiptDate);
    expect(second.releaseDate).toEqual(first.releaseDate);
    await mrp.firmDailyProposal(tenantId, userId, second.id, true);
    const thirdRun = await run(scenario);
    expect((await mrp.findDailyProposal(tenantId, second.id)).status).toBe("FIRMED");
    expect((await proposalsForRun(scenario, thirdRun.id)).filter((item: any) => item.itemId === scenario.rawId)).toHaveLength(0);
  });

  it("N - proposes only an increased demand quantity not covered by firm supply", async () => {
    const scenario = await createScenario("N");
    await parameter(scenario, "MATERIAL", scenario.rawId);
    await demand(scenario, "MATERIAL", scenario.rawId, 100);
    const firstRun = await run(scenario);
    const firm = await proposedForItem(scenario, firstRun.id, scenario.rawId);
    await mrp.firmDailyProposal(tenantId, userId, firm.id, true);
    await demand(scenario, "MATERIAL", scenario.rawId, 40);
    const secondRun = await run(scenario);
    expect((await proposedForItem(scenario, secondRun.id, scenario.rawId))?.quantity.toString()).toBe("40");
    expect((await mrp.findDailyProposal(tenantId, firm.id)).quantity.toString()).toBe("100");
  });

  it("O - surfaces a quantity-excess exception instead of mutating decreased firm supply", async () => {
    const scenario = await createScenario("O");
    await parameter(scenario, "MATERIAL", scenario.rawId);
    const source = await demand(scenario, "MATERIAL", scenario.rawId, 100);
    const firstRun = await run(scenario);
    const firm = await proposedForItem(scenario, firstRun.id, scenario.rawId);
    await mrp.firmDailyProposal(tenantId, userId, firm.id, true);
    await (prisma as any).mrpIndependentDemand.update({ where: { id: source.id }, data: { quantity: 60 } });
    const secondRun = await run(scenario);
    const exceptions = await (prisma as any).mrpException.findMany({ where: { tenantId, runId: secondRun.id, itemId: scenario.rawId } });
    expect(exceptions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "QUANTITY_EXCESS", quantity: expect.objectContaining({ toString: expect.any(Function) }), supplyType: "FIRM_PROPOSAL", supplyId: firm.id })]));
    expect(exceptions.find((item: any) => item.type === "QUANTITY_EXCESS")?.quantity.toString()).toBe("40");
    expect((await mrp.findDailyProposal(tenantId, firm.id)).quantity.toString()).toBe("100");
  });

  it("P - recommends reschedule-in and reschedule-out without duplicate proposals", async () => {
    const earlier = await createScenario("P-in");
    await parameter(earlier, "MATERIAL", earlier.rawId);
    const laterDemand = await demand(earlier, "MATERIAL", earlier.rawId, 10, NEXT_MONDAY);
    const initialLaterRun = await run(earlier);
    const laterFirm = await proposedForItem(earlier, initialLaterRun.id, earlier.rawId);
    await mrp.firmDailyProposal(tenantId, userId, laterFirm.id, true);
    await (prisma as any).mrpIndependentDemand.update({ where: { id: laterDemand.id }, data: { requiredDate: MONDAY } });
    const movedEarlierRun = await run(earlier);
    expect(await proposedForItem(earlier, movedEarlierRun.id, earlier.rawId)).toBeUndefined();
    expect(await (prisma as any).mrpException.findFirst({ where: { tenantId, runId: movedEarlierRun.id, type: "RESCHEDULE_IN", supplyId: laterFirm.id } })).not.toBeNull();

    const later = await createScenario("P-out");
    await parameter(later, "MATERIAL", later.rawId);
    const earlyDemand = await demand(later, "MATERIAL", later.rawId, 10, MONDAY);
    const initialEarlyRun = await run(later);
    const earlyFirm = await proposedForItem(later, initialEarlyRun.id, later.rawId);
    await mrp.firmDailyProposal(tenantId, userId, earlyFirm.id, true);
    await (prisma as any).mrpIndependentDemand.update({ where: { id: earlyDemand.id }, data: { requiredDate: NEXT_MONDAY } });
    const movedLaterRun = await run(later);
    expect(await proposedForItem(later, movedLaterRun.id, later.rawId)).toBeUndefined();
    expect(await (prisma as any).mrpException.findFirst({ where: { tenantId, runId: movedLaterRun.id, type: "RESCHEDULE_OUT", supplyId: earlyFirm.id } })).not.toBeNull();
  });

  it("Q - converts MAKE through one planned WO and the canonical engineering release boundary", async () => {
    const scenario = await createScenario("Q");
    const definition = await releasedDefinition(scenario);
    await parameter(scenario, "PART", scenario.fgId);
    await parameter(scenario, "MATERIAL", scenario.rawId);
    await demand(scenario, "PART", scenario.fgId, 10);
    const mrpRun = await run(scenario);
    const proposal = await proposedForItem(scenario, mrpRun.id, scenario.fgId);
    await mrp.firmDailyProposal(tenantId, userId, proposal.id, true);
    const converted = await mrp.convertDailyProposal(tenantId, userId, proposal.id, "MAKE");
    expect(converted).toMatchObject({ status: "CONVERTED", convertedToType: "WORK_ORDER" });
    const wo = await prisma.workOrder.findFirstOrThrow({ where: { tenantId, id: converted.convertedToId! } });
    expect(wo).toMatchObject({ plantId: scenario.plantId, partId: scenario.fgId, status: "PLANNED", engineeringReleaseRequired: true });
    expect(wo.quantity.toString()).toBe("10");
    expect(wo.dueDate).toEqual(proposal.receiptDate);
    const released = await workOrders.releaseEngineering(tenantId, userId, wo.id, { plantId: scenario.plantId, productionDefinitionId: definition.id });
    expect(released).toMatchObject({ status: "RELEASED", productionDefinitionId: definition.id });
  });

  it("R - converts BUY to a durable requisition boundary and never creates a PO", async () => {
    const { scenario, proposal } = await buyProposal("R", 12);
    const poCount = await prisma.purchaseOrder.count({ where: { tenantId } });
    await mrp.firmDailyProposal(tenantId, userId, proposal.id, true);
    const converted = await mrp.convertDailyProposal(tenantId, userId, proposal.id, "BUY");
    const requisition = await (prisma as any).purchaseRequisition.findFirstOrThrow({ where: { tenantId, id: converted.convertedToId }, include: { lines: true } });
    expect(converted.convertedToType).toBe("PURCHASE_REQUISITION");
    expect(requisition).toMatchObject({ plantId: scenario.plantId, mrpProposalId: proposal.id, status: "DRAFT" });
    expect(requisition.lines).toHaveLength(1);
    expect(requisition.lines[0]).toMatchObject({ itemType: "MATERIAL", itemId: scenario.rawId });
    expect(requisition.lines[0].quantity.toString()).toBe("12");
    expect(await prisma.purchaseOrder.count({ where: { tenantId } })).toBe(poCount);
  });

  it("S - returns the same downstream document for an idempotent conversion retry", async () => {
    const { proposal } = await buyProposal("S", 8);
    await mrp.firmDailyProposal(tenantId, userId, proposal.id, true);
    const first = await mrp.convertDailyProposal(tenantId, userId, proposal.id, "BUY");
    const retry = await mrp.convertDailyProposal(tenantId, userId, proposal.id, "BUY");
    expect(retry.convertedToId).toBe(first.convertedToId);
    expect(await (prisma as any).purchaseRequisition.count({ where: { tenantId, mrpProposalId: proposal.id } })).toBe(1);
  });

  it("T - serializes concurrent conversion to exactly one downstream document", async () => {
    const { proposal } = await buyProposal("T", 9);
    await mrp.firmDailyProposal(tenantId, userId, proposal.id, true);
    const converted = await Promise.all([
      mrp.convertDailyProposal(tenantId, userId, proposal.id, "BUY"),
      mrp.convertDailyProposal(tenantId, userId, proposal.id, "BUY"),
    ]);
    expect(converted[0].convertedToId).toBe(converted[1].convertedToId);
    expect(await (prisma as any).purchaseRequisition.count({ where: { tenantId, mrpProposalId: proposal.id } })).toBe(1);
  });

  it("U - treats a converted requisition as supply and does not recreate the proposal", async () => {
    const { scenario, proposal } = await buyProposal("U", 11);
    await mrp.firmDailyProposal(tenantId, userId, proposal.id, true);
    await mrp.convertDailyProposal(tenantId, userId, proposal.id, "BUY");
    const nextRun = await run(scenario);
    expect(await proposedForItem(scenario, nextRun.id, scenario.rawId)).toBeUndefined();
    expect((await mrp.findDailyProposal(tenantId, proposal.id)).status).toBe("CONVERTED");
  });

  it("V - rejects cross-tenant plant/item access and hides tenant proposals", async () => {
    const { scenario, proposal } = await buyProposal("V", 3);
    const otherTenantId = `cnc-v1-03r-other-${stamp}`;
    await prisma.tenant.create({ data: { id: otherTenantId, name: "Other tenant", timezone: "Europe/Istanbul" } });
    const otherUserId = (await prisma.user.create({ data: { tenantId: otherTenantId, email: `other-${stamp}@test.local`, name: "Other", passwordHash: "x", role: "ADMIN" } })).id;
    await expect(mrp.findDailyProposal(otherTenantId, proposal.id)).rejects.toThrow("not found");
    expect(await mrp.listDailyProposals(otherTenantId, {})).toHaveLength(0);
    await expect(mrp.upsertPlanningParameter(otherTenantId, otherUserId, { plantId: scenario.plantId, itemType: "MATERIAL", itemId: scenario.rawId, policy: "BUY", leadTimeWorkingDays: 0, lotSizingRule: "LOT_FOR_LOT", safetyStock: 0, planningEnabled: true, rescheduleToleranceDays: 1 })).rejects.toThrow("Plant was not found");
  });

  it("W - never nets stock from another plant without an interplant policy", async () => {
    const planningPlant = await createScenario("W-plan");
    const stockPlant = await createPlant("W-stock");
    await addStock(stockPlant, "MATERIAL", planningPlant.rawId, 50);
    await parameter(planningPlant, "MATERIAL", planningPlant.rawId);
    await demand(planningPlant, "MATERIAL", planningPlant.rawId, 50);
    const mrpRun = await run(planningPlant);
    const proposal = await proposedForItem(planningPlant, mrpRun.id, planningPlant.rawId);
    expect(proposal?.quantity.toString()).toBe("50");
    expect((proposal?.calculation as any).openingUsable).toBe(0);
  });

  it("X - plans 1000 independent items without per-item calendar or insert N+1", async () => {
    const scenario = await createPlant("X-performance");
    const items = Array.from({ length: 1000 }, (_, index) => ({
      id: randomUUID(),
      tenantId,
      code: `PERF-${stamp}-${index}`,
      name: `Performance material ${index}`,
      type: "RAW" as const,
      unit: "EA",
    }));
    await prisma.material.createMany({ data: items });
    await (prisma as any).mrpPlanningParameter.createMany({
      data: items.map((item) => ({ tenantId, plantId: scenario.plantId, itemType: "MATERIAL", itemId: item.id, policy: "BUY", leadTimeWorkingDays: 2, lotSizingRule: "LOT_FOR_LOT", safetyStock: 0, planningEnabled: true, rescheduleToleranceDays: 1 })),
    });
    await (prisma as any).mrpIndependentDemand.createMany({
      data: items.map((item) => ({ tenantId, plantId: scenario.plantId, itemType: "MATERIAL", itemId: item.id, quantity: 1, requiredDate: MONDAY, createdById: userId })),
    });

    const startedAt = performance.now();
    const mrpRun = await run(scenario);
    const durationMs = performance.now() - startedAt;
    const [proposalCount, peggingCount, bucketCount] = await Promise.all([
      (prisma as any).mrpProposal.count({ where: { tenantId, runId: mrpRun.id } }),
      (prisma as any).mrpPegging.count({ where: { tenantId, proposal: { runId: mrpRun.id } } }),
      (prisma as any).mrpBucket.count({ where: { tenantId, runId: mrpRun.id } }),
    ]);
    expect({ proposalCount, peggingCount, bucketCount }).toEqual({ proposalCount: 1000, peggingCount: 1000, bucketCount: 2000 });
    expect(durationMs).toBeLessThan(30_000);
  });

  it("Y - respects a shorter plant-item planning horizon", async () => {
    const scenario = await createScenario("Y");
    await parameter(scenario, "MATERIAL", scenario.rawId, { planningHorizonDays: 3 });
    await demand(scenario, "MATERIAL", scenario.rawId, 7, NEXT_MONDAY);
    const mrpRun = await run(scenario);
    expect(await proposedForItem(scenario, mrpRun.id, scenario.rawId)).toBeUndefined();
  });

  it("Z1 - plans an assigned sales line exactly once in its fulfillment plant with full traceability", async () => {
    const plantA = await createScenario("Z1-A");
    const plantB = await createScenario("Z1-B");
    await parameter(plantA, "PART", plantA.fgId);
    await parameter(plantB, "PART", plantA.fgId);
    const customer = await prisma.customer.create({ data: { tenantId, name: `Z1 customer ${stamp}` } });
    const order = await prisma.salesOrder.create({
      data: {
        tenantId, soNo: `Z1-${stamp}`, customerId: customer.id, createdById: userId,
        lines: { create: { tenantId, partId: plantA.fgId, quantity: 12, unitPrice: 1, dueDate: MONDAY } },
      }, include: { lines: true },
    });
    const line = order.lines[0]!;
    await salesOrders.assignFulfillmentPlant(tenantId, userId, order.id, line.id, { plantId: plantA.plantId });

    const [runA, runB] = await Promise.all([run(plantA), run(plantB)]);
    const proposalA = await proposedForItem(plantA, runA.id, plantA.fgId);
    expect(proposalA?.quantity.toString()).toBe("12");
    expect(proposalA?.sourceDemandType).toBe("SALES_ORDER_LINE");
    expect(proposalA?.sourceDemandId).toBe(line.id);
    expect(proposalA?.peggings).toEqual(expect.arrayContaining([expect.objectContaining({ demandType: "SALES_ORDER_LINE", demandId: line.id })]));
    expect(await proposedForItem(plantB, runB.id, plantA.fgId)).toBeUndefined();
    expect(await (prisma as any).mrpProposal.count({ where: { tenantId, sourceDemandType: "SALES_ORDER_LINE", sourceDemandId: line.id, status: "PROPOSED" } })).toBe(1);
    await releasedDefinition(plantA);
    await mrp.firmDailyProposal(tenantId, userId, proposalA.id, true);
    const converted = await mrp.convertDailyProposal(tenantId, userId, proposalA.id, "MAKE");
    const workOrder = await prisma.workOrder.findFirstOrThrow({ where: { tenantId, id: converted.convertedToId! } });
    expect(workOrder).toMatchObject({ plantId: plantA.plantId, mrpProposalId: proposalA.id, partId: line.partId });
  });

  it("Z2 - keeps unassigned sales demand non-plannable and rejects cross-tenant assignment", async () => {
    const plantA = await createScenario("Z2-A");
    const plantB = await createScenario("Z2-B");
    await parameter(plantA, "PART", plantA.fgId);
    await parameter(plantB, "PART", plantA.fgId);
    const customer = await prisma.customer.create({ data: { tenantId, name: `Z2 customer ${stamp}` } });
    const order = await prisma.salesOrder.create({ data: { tenantId, soNo: `Z2-${stamp}`, customerId: customer.id, createdById: userId, lines: { create: { tenantId, partId: plantA.fgId, quantity: 5, unitPrice: 1, dueDate: MONDAY } } }, include: { lines: true } });
    const line = order.lines[0]!;
    const [runA, runB] = await Promise.all([run(plantA), run(plantB)]);
    expect(await proposedForItem(plantA, runA.id, plantA.fgId)).toBeUndefined();
    expect(await proposedForItem(plantB, runB.id, plantA.fgId)).toBeUndefined();

    const otherTenantId = `z2-other-${stamp}`;
    await prisma.tenant.create({ data: { id: otherTenantId, name: "Z2 other", timezone: "Europe/Istanbul" } });
    const otherPlant = await prisma.plant.create({ data: { tenantId: otherTenantId, name: "Z2 other plant" } });
    await expect(salesOrders.assignFulfillmentPlant(tenantId, userId, order.id, line.id, { plantId: otherPlant.id })).rejects.toThrow("Plant was not found");
  });

  it("Z3 - removes cancelled sales demand from the next run and keeps standalone independent demand supported", async () => {
    const sales = await createScenario("Z3-sales");
    await parameter(sales, "PART", sales.fgId);
    const customer = await prisma.customer.create({ data: { tenantId, name: `Z3 customer ${stamp}` } });
    const order = await prisma.salesOrder.create({ data: { tenantId, soNo: `Z3-${stamp}`, customerId: customer.id, createdById: userId, lines: { create: { tenantId, partId: sales.fgId, quantity: 6, unitPrice: 1, dueDate: MONDAY, fulfillmentPlantId: sales.plantId } } }, include: { lines: true } });
    const first = await run(sales);
    expect((await proposedForItem(sales, first.id, sales.fgId))?.quantity.toString()).toBe("6");
    await salesOrders.setStatus(tenantId, order.id, "CANCELLED");
    const next = await run(sales);
    expect(await proposedForItem(sales, next.id, sales.fgId)).toBeUndefined();

    const standalone = await createScenario("Z3-standalone");
    await parameter(standalone, "MATERIAL", standalone.rawId);
    const independent = await demand(standalone, "MATERIAL", standalone.rawId, 4);
    const standaloneRun = await run(standalone);
    expect((await proposedForItem(standalone, standaloneRun.id, standalone.rawId))?.sourceDemandId).toBe(independent.id);
  });

  it("SNAP-A - inventory committed after snapshot affects only the next run", async () => {
    const scenario = await createScenario("SNAP-A");
    await addStock(scenario, "MATERIAL", scenario.rawId, 100);
    await parameter(scenario, "MATERIAL", scenario.rawId);
    await demand(scenario, "MATERIAL", scenario.rawId, 150);
    const barrier = pauseAt("SNAPSHOT_ESTABLISHED");
    const currentPromise = run(scenario);
    await barrier.reached;
    await addStock(scenario, "MATERIAL", scenario.rawId, 30);
    barrier.resume();
    const current = await currentPromise;
    expect((await proposedForItem(scenario, current.id, scenario.rawId))?.quantity.toString()).toBe("50");
    expect(current).toMatchObject({ inputSnapshotStrategy: "POSTGRESQL_REPEATABLE_READ", inputSnapshotVersion: 1 });
    expect(current.inputSnapshotAt).toBeInstanceOf(Date);
    jest.restoreAllMocks();
    const next = await run(scenario);
    expect((await proposedForItem(scenario, next.id, scenario.rawId))?.quantity.toString()).toBe("20");
  });

  it("SNAP-B - reservation committed after snapshot affects only the next run", async () => {
    const scenario = await createScenario("SNAP-B");
    const lot = await addStock(scenario, "MATERIAL", scenario.rawId, 100);
    const definition = await releasedDefinition(scenario, 1);
    const wo = await workOrders.create(tenantId, { partId: scenario.fgId, plantId: scenario.plantId, quantity: 40, dueDate: MONDAY, priority: 5 });
    const released = await workOrders.releaseEngineering(tenantId, userId, wo.id, { plantId: scenario.plantId, productionDefinitionId: definition.id });
    const requirement = (await materials.requirements(tenantId, released.id))[0]!;
    await parameter(scenario, "MATERIAL", scenario.rawId);
    const barrier = pauseAt("SNAPSHOT_ESTABLISHED");
    const currentPromise = run(scenario);
    await barrier.reached;
    await materials.reserve(tenantId, userId, { requirementId: requirement.id, binId: scenario.binId, lotId: lot.id, quantity: 40, idempotencyKey: `SNAP-B-${stamp}` });
    barrier.resume();
    const current = await currentPromise;
    expect((await (prisma as any).mrpBucket.findFirstOrThrow({ where: { runId: current.id, itemId: scenario.rawId }, orderBy: { bucketDate: "asc" } })).openingAvailable.toString()).toBe("100");
    jest.restoreAllMocks();
    const next = await run(scenario);
    const nextBucket = await (prisma as any).mrpBucket.findFirstOrThrow({ where: { runId: next.id, itemId: scenario.rawId }, orderBy: { bucketDate: "asc" } });
    expect(nextBucket.openingAvailable.toString()).toBe("60");
    const nextBuckets = await (prisma as any).mrpBucket.findMany({ where: { runId: next.id, itemId: scenario.rawId } });
    expect(nextBuckets.reduce((sum: number, bucket: any) => sum + Number(bucket.reservationCoverage), 0)).toBe(40);
  });

  it("SNAP-C - work-order cancellation committed after snapshot affects only the next run", async () => {
    const scenario = await createScenario("SNAP-C");
    const definition = await releasedDefinition(scenario, 1);
    await parameter(scenario, "PART", scenario.fgId);
    await demand(scenario, "PART", scenario.fgId, 150);
    const wo = await workOrders.create(tenantId, { partId: scenario.fgId, plantId: scenario.plantId, quantity: 100, dueDate: MONDAY, priority: 5 });
    await workOrders.releaseEngineering(tenantId, userId, wo.id, { plantId: scenario.plantId, productionDefinitionId: definition.id });
    const barrier = pauseAt("SNAPSHOT_ESTABLISHED");
    const currentPromise = run(scenario);
    await barrier.reached;
    await prisma.workOrder.update({ where: { id: wo.id }, data: { status: "CANCELLED" } });
    barrier.resume();
    const current = await currentPromise;
    expect((await proposedForItem(scenario, current.id, scenario.fgId))?.quantity.toString()).toBe("50");
    jest.restoreAllMocks();
    const next = await run(scenario);
    expect((await proposedForItem(scenario, next.id, scenario.fgId))?.quantity.toString()).toBe("150");
  });

  it("SNAP-D - engineering revision released after snapshot is used only by the next run", async () => {
    const scenario = await createScenario("SNAP-D");
    await releasedDefinition(scenario, 2);
    await parameter(scenario, "PART", scenario.fgId);
    await parameter(scenario, "MATERIAL", scenario.rawId);
    await demand(scenario, "PART", scenario.fgId, 10);
    const bomB = await boms.create(tenantId, { partId: scenario.fgId, revision: "B", lines: [{ itemType: "MATERIAL", itemId: scenario.rawId, qtyPer: 3, unit: "EA", issueMethod: "MANUAL_ISSUE", consumeOnScrap: true }] });
    const routingB = await recipes.create(tenantId, { partId: scenario.fgId, revision: "B", steps: [{ seq: 1, name: "Revision B", standardMinutes: 5 }] });
    const definitionB = await definitions.create(tenantId, userId, { plantId: scenario.plantId, partId: scenario.fgId, bomHeaderId: bomB.id, recipeHeaderId: routingB.id });
    const barrier = pauseAt("SNAPSHOT_ESTABLISHED");
    const currentPromise = run(scenario);
    await barrier.reached;
    await boms.setStatus(tenantId, userId, bomB.id, { status: "RELEASED" });
    await recipes.setStatus(tenantId, userId, routingB.id, { status: "RELEASED" });
    await definitions.setStatus(tenantId, userId, definitionB.id, { status: "RELEASED" });
    barrier.resume();
    const current = await currentPromise;
    expect((await proposedForItem(scenario, current.id, scenario.rawId))?.quantity.toString()).toBe("20");
    jest.restoreAllMocks();
    const next = await run(scenario);
    expect((await proposedForItem(scenario, next.id, scenario.rawId))?.quantity.toString()).toBe("30");
  });

  it("SNAP-E - calendar and planning-parameter changes after snapshot affect only the next run", async () => {
    const scenario = await createScenario("SNAP-E");
    const planningParameter = await parameter(scenario, "MATERIAL", scenario.rawId, { leadTimeWorkingDays: 1 });
    await demand(scenario, "MATERIAL", scenario.rawId, 10, MONDAY);
    const calendar = await prisma.plantProductionCalendar.findFirstOrThrow({ where: { tenantId, plantId: scenario.plantId } });
    const barrier = pauseAt("SNAPSHOT_ESTABLISHED");
    const currentPromise = run(scenario);
    await barrier.reached;
    await prisma.$transaction([
      prisma.plantProductionCalendarException.create({ data: { tenantId, calendarId: calendar.id, date: new Date("2026-08-14T00:00:00.000Z"), isWorking: false, name: "Concurrent holiday" } }),
      (prisma as any).mrpPlanningParameter.update({ where: { id: planningParameter.id }, data: { leadTimeWorkingDays: 2 } }),
    ]);
    barrier.resume();
    const current = await currentPromise;
    expect((await proposedForItem(scenario, current.id, scenario.rawId))?.releaseDate.toISOString().slice(0, 10)).toBe("2026-08-14");
    jest.restoreAllMocks();
    const next = await run(scenario);
    expect((await proposedForItem(scenario, next.id, scenario.rawId))?.releaseDate.toISOString().slice(0, 10)).toBe("2026-08-12");
  });

  it("SNAP-F - a failed publication rolls back all derived rows and leaves the prior completed plan visible", async () => {
    const scenario = await createScenario("SNAP-F");
    await parameter(scenario, "MATERIAL", scenario.rawId);
    const source = await demand(scenario, "MATERIAL", scenario.rawId, 10);
    const successful = await run(scenario);
    const priorProposal = await proposedForItem(scenario, successful.id, scenario.rawId);
    await (prisma as any).mrpIndependentDemand.update({ where: { id: source.id }, data: { quantity: 20 } });
    jest.spyOn(synchronization, "reached").mockImplementation(async (point) => { if (point === "PUBLICATION_STAGED") throw new Error("forced publication failure"); });
    await expect(run(scenario)).rejects.toThrow("forced publication failure");
    const failed = await (prisma as any).mrpRun.findFirstOrThrow({ where: { tenantId, plantId: scenario.plantId, status: "FAILED" }, orderBy: { startedAt: "desc" } });
    expect(await (prisma as any).mrpProposal.count({ where: { runId: failed.id } })).toBe(0);
    expect(await (prisma as any).mrpBucket.count({ where: { runId: failed.id } })).toBe(0);
    expect(await (prisma as any).mrpException.count({ where: { runId: failed.id } })).toBe(0);
    expect((await mrp.findDailyProposal(tenantId, priorProposal.id)).status).toBe("PROPOSED");
    expect((await (prisma as any).mrpRun.findFirstOrThrow({ where: { tenantId, plantId: scenario.plantId, status: "COMPLETED" }, orderBy: { completedAt: "desc" } })).id).toBe(successful.id);
  });
});
