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

const stamp = Date.now();

describe("CNC-V1-01 released engineering master data (PostgreSQL e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let parts: PartsService;
  let boms: BomService;
  let recipes: RecipesService;
  let definitions: ProductionDefinitionsService;
  let workOrders: WorkOrdersService;
  let tenantId: string;
  let actorId: string;
  let plantId: string;
  let partId: string;
  let rawId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); await app.init();
    prisma = app.get(PrismaService); parts = app.get(PartsService); boms = app.get(BomService); recipes = app.get(RecipesService); definitions = app.get(ProductionDefinitionsService); workOrders = app.get(WorkOrdersService);
    tenantId = `cnc-v1-01-${stamp}`;
    await prisma.tenant.create({ data: { id: tenantId, name: "CNC V1-01 Test", timezone: "Europe/Istanbul" } });
    const actor = await prisma.user.create({ data: { tenantId, email: `cnc-v1-01-${stamp}@test.local`, name: "Engineer", passwordHash: await bcrypt.hash("TestPassword123!", 10), role: "ADMIN" } }); actorId = actor.id;
    plantId = (await prisma.plant.create({ data: { tenantId, name: "Ankara", timezone: "Europe/Istanbul" } })).id;
    rawId = (await prisma.material.create({ data: { tenantId, code: "RAW-1", name: "Raw", type: "RAW", unit: "KG" } })).id;
    partId = (await parts.create(tenantId, { partNo: "P-100", revision: "A", name: "Machined Part", unit: "EA" })).id;
  });
  afterAll(async () => app.close());

  async function releasedDefinition(revision: string, idealCycleTimeSec: number) {
    const bom = await boms.create(tenantId, { partId, revision, lines: [{ itemType: "MATERIAL", itemId: rawId, qtyPer: 2, unit: "KG", issueMethod: "MANUAL_ISSUE", consumeOnScrap: true }] });
    const routing = await recipes.create(tenantId, { partId, revision, steps: [{ seq: 1, name: "OP10 machining", standardMinutes: 10, idealCycleTimeSec }, { seq: 2, name: "OP20 inspection", standardMinutes: 5 }] });
    await parts.setEngineeringStatus(tenantId, actorId, partId, { status: "RELEASED" });
    await boms.setStatus(tenantId, actorId, bom.id, { status: "RELEASED" });
    await recipes.setStatus(tenantId, actorId, routing.id, { status: "RELEASED" });
    const definition = await definitions.create(tenantId, actorId, { plantId, partId, bomHeaderId: bom.id, recipeHeaderId: routing.id });
    await definitions.setStatus(tenantId, actorId, definition.id, { status: "RELEASED" });
    return { bom, routing, definition };
  }

  it("rejects draft engineering and keeps A snapshot immutable while new work uses B", async () => {
    const a = await releasedDefinition("A", 12.5);
    const wo100 = await workOrders.create(tenantId, { partId, plantId, quantity: 10, dueDate: new Date("2026-09-01"), priority: 5 });
    expect(wo100.operations).toHaveLength(0);
    const released100 = await workOrders.releaseEngineering(tenantId, actorId, wo100.id, { plantId, productionDefinitionId: a.definition.id });
    expect(released100.status).toBe("RELEASED");
    expect(released100.recipeRevision).toBe("A");
    expect(released100.operations).toHaveLength(2);
    expect(Number(released100.operations[0].idealCycleTimeSec)).toBe(12.5);
    expect(released100.engineeringSnapshot).toEqual(expect.objectContaining({
      bom: expect.objectContaining({ revision: "A" }),
      routing: expect.objectContaining({
        revision: "A",
        operations: expect.arrayContaining([expect.objectContaining({ seq: 1, idealCycleTimeSec: "12.5" })]),
      }),
    }));
    await expect(boms.update(tenantId, a.bom.id, { notes: "must not mutate" })).rejects.toThrow("cannot be changed");
    await expect(recipes.update(tenantId, a.routing.id, { notes: "must not mutate" })).rejects.toThrow("cannot be changed");

    const b = await releasedDefinition("B", 8);
    const wo101 = await workOrders.create(tenantId, { partId, plantId, quantity: 12, dueDate: new Date("2026-09-02"), priority: 5 });
    const released101 = await workOrders.releaseEngineering(tenantId, actorId, wo101.id, { plantId, productionDefinitionId: b.definition.id });
    expect(released101.recipeRevision).toBe("B");
    expect(Number(released101.operations[0].idealCycleTimeSec)).toBe(8);
    const historicalA = await workOrders.findOne(tenantId, wo100.id);
    expect(historicalA.recipeRevision).toBe("A");
    expect(Number(historicalA.operations[0].idealCycleTimeSec)).toBe(12.5);

    const draftBom = await boms.create(tenantId, { partId, revision: "C", lines: [{ itemType: "MATERIAL", itemId: rawId, qtyPer: 3, unit: "KG", issueMethod: "MANUAL_ISSUE", consumeOnScrap: true }] });
    const draftRouting = await recipes.create(tenantId, { partId, revision: "C", steps: [{ seq: 1, name: "Draft OP" }] });
    const draftDefinition = await definitions.create(tenantId, actorId, { plantId, partId, bomHeaderId: draftBom.id, recipeHeaderId: draftRouting.id });
    const woDraft = await workOrders.create(tenantId, { partId, plantId, quantity: 1, dueDate: new Date("2026-09-03"), priority: 5 });
    await expect(workOrders.releaseEngineering(tenantId, actorId, woDraft.id, { plantId, productionDefinitionId: draftDefinition.id })).rejects.toThrow("No matching released production definition");
  });
});
