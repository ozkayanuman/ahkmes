import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();

describe("OEE hesaplama (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let partId: string;
  let workOrderId: string;
  let runId: string;
  let plantId: string;
  let rawMaterialId: string;

  const auth = (r: request.Test) => r.set("Authorization", `Bearer ${adminToken}`);
  const api = () => request(app.getHttpServer());
  /** GET .../oee artık açık plantId/from/to/asOf bağlamı gerektirir (CNC-V1-08R). */
  function oeeContext() {
    const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const to = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const asOf = new Date().toISOString();
    return `plantId=${plantId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&asOf=${encodeURIComponent(asOf)}`;
  }

  /** BOM+Recipe+ProductionDefinition'ı yayınlayıp iş emrini release-engineering
   * ile geçirir, ardından tek operasyon için koşu başlatır. */
  async function releasedRun(pId: string, quantity: number) {
    const revision = `REL-${Math.random().toString(36).slice(2)}`;
    const bom = await auth(api().post("/boms").send({
      partId: pId, revision,
      lines: [{ itemType: "MATERIAL", itemId: rawMaterialId, qtyPer: 1, unit: "KG" }],
    }));
    const recipe = await auth(api().post("/recipes").send({ partId: pId, revision, steps: [{ seq: 1, name: "OEE operasyonu" }] }));
    await auth(api().patch(`/parts/${pId}/engineering-status`).send({ status: "RELEASED" })).expect(200);
    await auth(api().patch(`/boms/${bom.body.id}/status`).send({ status: "RELEASED" })).expect(200);
    await auth(api().patch(`/recipes/${recipe.body.id}/status`).send({ status: "RELEASED" })).expect(200);
    const definition = await auth(api().post("/production-definitions").send({
      plantId, partId: pId, bomHeaderId: bom.body.id, recipeHeaderId: recipe.body.id,
    }));
    await auth(api().patch(`/production-definitions/${definition.body.id}/status`).send({ status: "RELEASED" })).expect(200);
    const created = await auth(api().post("/work-orders").send({
      partId: pId, quantity, dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    }));
    const released = await auth(api().post(`/work-orders/${created.body.id}/release-engineering`).send({
      plantId, productionDefinitionId: definition.body.id,
    })).expect(201);
    const run = await auth(api().post(`/work-orders/${released.body.id}/runs`).send({ operationId: released.body.operations[0].id }));
    return { workOrderId: released.body.id as string, runId: run.body.id as string };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const login = await api()
      .post("/auth/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    adminToken = login.body.accessToken;

    plantId = (await auth(api().post("/hierarchy/plants").send({ name: `OEE Plant ${STAMP}` }))).body.id;
    rawMaterialId = (await auth(api().post("/materials").send({ code: `OEE-RAW-${STAMP}`, name: "OEE Hammadde", type: "RAW", unit: "KG" }))).body.id;

    partId = (
      await auth(
        api()
          .post("/parts")
          .send({ partNo: `OEE-${STAMP}`, revision: "A", name: "OEE Testi", idealCycleTimeSec: 10 }),
      )
    ).body.id;
    const run = await releasedRun(partId, 100);
    workOrderId = run.workOrderId;
    runId = run.runId;
  });

  afterAll(async () => {
    await prisma.productionRun.deleteMany({ where: { workOrderId } });
    await prisma.workOrderCostBaseline.deleteMany({ where: { workOrderId } });
    await prisma.workOrder.deleteMany({ where: { id: workOrderId } });
    await prisma.productionDefinition.deleteMany({ where: { partId } });
    await prisma.bomHeader.deleteMany({ where: { partId } });
    await prisma.recipeHeader.deleteMany({ where: { partId } });
    await prisma.part.deleteMany({ where: { id: partId } });
    await app.close();
  });

  it("idealCycleTimeSec yokken performance/oee null döner, quality hesaplanır", async () => {
    const partNoIdeal = (
      await auth(api().post("/parts").send({ partNo: `OEE-NOIDEAL-${STAMP}`, revision: "A", name: "İdealsiz" }))
    ).body.id;
    const { workOrderId: woNoIdeal } = await releasedRun(partNoIdeal, 10);

    const res = await auth(api().get(`/work-orders/${woNoIdeal}/oee?${oeeContext()}`)).expect(200);
    expect(res.body.performance).toBeNull();
    expect(res.body.oee).toBeNull();
    expect(res.body.availability).toBeNull();

    await prisma.productionRun.deleteMany({ where: { workOrderId: woNoIdeal } });
    await prisma.workOrderCostBaseline.deleteMany({ where: { workOrderId: woNoIdeal } });
    await prisma.workOrder.deleteMany({ where: { id: woNoIdeal } });
    await prisma.productionDefinition.deleteMany({ where: { partId: partNoIdeal } });
    await prisma.bomHeader.deleteMany({ where: { partId: partNoIdeal } });
    await prisma.recipeHeader.deleteMany({ where: { partId: partNoIdeal } });
    await prisma.part.deleteMany({ where: { id: partNoIdeal } });
  });

  it("goodCount/scrapCount girilince quality doğru hesaplanır", async () => {
    await auth(api().patch(`/runs/${runId}`).send({ goodCount: 8, scrapCount: 2 })).expect(200);
    const res = await auth(api().get(`/work-orders/${workOrderId}/oee?${oeeContext()}`)).expect(200);
    expect(res.body.quality).toBeCloseTo(0.8, 2);
    expect(res.body.goodCount).toBe(8);
    expect(res.body.scrapCount).toBe(2);
  });

  it("idealCycleTimeSec varken performance ve oee hesaplanır (0-1 arası)", async () => {
    const res = await auth(api().get(`/work-orders/${workOrderId}/oee?${oeeContext()}`)).expect(200);
    expect(res.body.performance).not.toBeNull();
    expect(res.body.performance).toBeGreaterThanOrEqual(0);
    expect(res.body.performance).toBeLessThanOrEqual(1);
    expect(res.body.oee).toBeCloseTo(res.body.quality * res.body.performance, 5);
  });

  it("olmayan iş emri için 404 döner", async () => {
    await auth(api().get(`/work-orders/00000000-0000-0000-0000-000000000099/oee?${oeeContext()}`)).expect(404);
  });
});
