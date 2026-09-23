import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { CostingService } from "../src/costing/costing.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { PartsService } from "../src/parts/parts.service";
import { BomService } from "../src/mrp/bom.service";
import { RecipesService } from "../src/recipes/recipes.service";
import { ProductionDefinitionsService } from "../src/production-definitions/production-definitions.service";
import { WorkOrdersService } from "../src/work-orders/work-orders.service";

const stamp = Date.now();

describe("CNC-V1-09R planned-versus-actual costing (PostgreSQL e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let parts: PartsService;
  let boms: BomService;
  let recipes: RecipesService;
  let definitions: ProductionDefinitionsService;
  let workOrders: WorkOrdersService;
  let costing: CostingService;
  let tenantId: string;
  let userId: string;
  let token: string;
  let plantId: string;
  let machineId: string;
  let rawId: string;
  let partId: string;
  const api = () => request(app.getHttpServer());
  const auth = (value: request.Test) => value.set("Authorization", `Bearer ${token}`);

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); await app.init();
    prisma = app.get(PrismaService); parts = app.get(PartsService); boms = app.get(BomService); recipes = app.get(RecipesService); definitions = app.get(ProductionDefinitionsService); workOrders = app.get(WorkOrdersService); costing = app.get(CostingService);
    tenantId = `cnc-v1-09r-${stamp}`;
    await prisma.tenant.create({ data: { id: tenantId, name: "CNC V1-09R Test", timezone: "Europe/Istanbul" } });
    const admin = await prisma.user.create({ data: { tenantId, email: `costing-${stamp}@test.local`, name: "Costing Admin", passwordHash: await bcrypt.hash("TestPassword123!", 10), role: "ADMIN" } });
    userId = admin.id;
    await prisma.actionPermissionGrant.createMany({ data: ["COSTING_READ", "COSTING_RATE_ADMIN"].map((action) => ({ tenantId, action, userId, createdById: userId })) });
    token = (await api().post("/auth/login").send({ email: admin.email, password: "TestPassword123!" }).expect(201)).body.accessToken;
    plantId = (await prisma.plant.create({ data: { tenantId, name: "Costing Plant", timezone: "Europe/Istanbul" } })).id;
    machineId = (await prisma.machine.create({ data: { tenantId, plantId, name: "Costing CNC", model: "VMC", hourlyRate: 999 } })).id;
    rawId = (await prisma.material.create({ data: { tenantId, code: `RAW-${stamp}`, name: "Costing raw", type: "RAW", unit: "KG", standardCost: 999 } })).id;
    partId = (await parts.create(tenantId, { partNo: `COST-${stamp}`, revision: "A", name: "Costing part", unit: "EA" })).id;
  });
  afterAll(async () => app?.close());

  async function releasedDefinition() {
    const bom = await boms.create(tenantId, { partId, revision: "A", lines: [{ itemType: "MATERIAL", itemId: rawId, qtyPer: 2, unit: "KG", issueMethod: "MANUAL_ISSUE", consumeOnScrap: true }] });
    const routing = await recipes.create(tenantId, { partId, revision: "A", steps: [{ seq: 1, name: "Machining", standardMinutes: 60 }] });
    await parts.setEngineeringStatus(tenantId, userId, partId, { status: "RELEASED" });
    await boms.setStatus(tenantId, userId, bom.id, { status: "RELEASED" });
    await recipes.setStatus(tenantId, userId, routing.id, { status: "RELEASED" });
    const definition = await definitions.create(tenantId, userId, { plantId, partId, bomHeaderId: bom.id, recipeHeaderId: routing.id });
    await definitions.setStatus(tenantId, userId, definition.id, { status: "RELEASED" });
    return definition;
  }

  it("pins a released rate card at engineering release and calculates explainable actual variance", async () => {
    const effectiveFrom = new Date(Date.now() - 60_000).toISOString();
    const draft = await auth(api().post("/costing/rate-cards").send({ plantId, currency: "TRY", effectiveFrom, lines: [{ kind: "MATERIAL", targetId: rawId, rate: "3" }, { kind: "MACHINE", targetId: machineId, rate: "100" }, { kind: "LABOR", targetId: "DEFAULT", rate: "50" }] })).expect(201);
    await auth(api().post(`/costing/rate-cards/${draft.body.id}/release`).send({})).expect(201);
    const definition = await releasedDefinition();
    const workOrder = await workOrders.create(tenantId, { partId, plantId, machineId, quantity: 2, dueDate: new Date(Date.now() + 86_400_000), priority: 5 });
    const released = await workOrders.releaseEngineering(tenantId, userId, workOrder.id, { plantId, productionDefinitionId: definition.id });
    const baseline = await prisma.workOrderCostBaseline.findFirstOrThrow({ where: { tenantId, workOrderId: released.id }, include: { lines: true } });
    expect(baseline).toMatchObject({ rateCardId: draft.body.id, rateCardRevision: 1, currency: "TRY", dataQuality: "COMPLETE" });
    expect(Number(baseline.plannedMaterialCost)).toBe(12);
    expect(Number(baseline.plannedMachineCost)).toBe(100);
    expect(Number(baseline.plannedLaborCost)).toBe(50);

    await prisma.material.update({ where: { id: rawId }, data: { standardCost: 1 } });
    await prisma.machine.update({ where: { id: machineId }, data: { hourlyRate: 1 } });
    const operation = released.operations[0]!;
    const startedAt = new Date("2026-09-09T08:00:00.000Z");
    const endedAt = new Date("2026-09-09T10:00:00.000Z");
    const run = await prisma.productionRun.create({ data: { tenantId, workOrderId: released.id, operationId: operation.id, machineId, operatorId: userId, startedAt, endedAt } });
    await prisma.materialConsumption.create({ data: { tenantId, workOrderId: released.id, itemType: "MATERIAL", itemId: rawId, type: "CONSUMED", quantity: 5, createdById: userId, date: startedAt } });
    await prisma.productionReport.create({ data: { tenantId, workOrderId: released.id, operationId: operation.id, productionRunId: run.id, goodQty: 2, scrapQty: 1, idempotencyKey: `cost-report-${stamp}`, reportedById: userId, createdAt: endedAt } });

    const response = await auth(api().get(`/work-orders/${released.id}/cost?asOf=${encodeURIComponent("2026-09-09T11:00:00.000Z")}`)).expect(200);
    expect(response.body).toMatchObject({ currency: "TRY", dataQuality: "COMPLETE", planned: { total: 162 }, actual: { material: 15, machine: 200, labor: 100, total: 315 }, variance: { total: 153 }, unitCost: 157.5, output: { goodQty: 2, scrapQty: 1 } });
    expect(response.body.legacy).toMatchObject({ materialCost: 15, machineCost: 200, laborCost: 100, totalCost: 315 });
    const calculated = await costing.calculate(tenantId, released.id, new Date("2026-09-09T11:00:00.000Z"));
    expect(calculated.baseline?.id).toBe(baseline.id);
  });

  it("rejects foreign work-order ids rather than returning a partial costing view", async () => {
    const foreign = await prisma.tenant.create({ data: { name: `Foreign costing ${stamp}` } });
    const foreignUser = await prisma.user.create({ data: { tenantId: foreign.id, email: `foreign-cost-${stamp}@test.local`, name: "Foreign", passwordHash: await bcrypt.hash("TestPassword123!", 10), role: "ADMIN" } });
    await prisma.actionPermissionGrant.create({ data: { tenantId: foreign.id, action: "COSTING_READ", userId: foreignUser.id, createdById: foreignUser.id } });
    const foreignToken = (await api().post("/auth/login").send({ email: foreignUser.email, password: "TestPassword123!" }).expect(201)).body.accessToken;
    const workOrder = await prisma.workOrder.findFirstOrThrow({ where: { tenantId }, select: { id: true } });
    await api().get(`/work-orders/${workOrder.id}/cost`).set("Authorization", `Bearer ${foreignToken}`).expect(404);
  });
});
