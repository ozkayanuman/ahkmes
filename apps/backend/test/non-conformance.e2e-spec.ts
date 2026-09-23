import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();

describe("Non-Conformance (kalite) modülü (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let partId: string;
  let workOrderId: string;
  let runId: string;
  let ncId: string;

  const auth = (r: request.Test) => r.set("Authorization", `Bearer ${adminToken}`);
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const login = await api()
      .post("/auth/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    adminToken = login.body.accessToken;

    partId = (
      await auth(api().post("/parts").send({ partNo: `NC-${STAMP}`, revision: "A", name: "NC Testi" }))
    ).body.id;
    const plantId = (await auth(api().post("/hierarchy/plants").send({ name: `NC Plant ${STAMP}` }))).body.id;
    const rawMaterialId = (await auth(api().post("/materials").send({ code: `NC-RAW-${STAMP}`, name: "NC Hammadde", type: "RAW", unit: "KG" }))).body.id;
    const bom = await auth(api().post("/boms").send({
      partId, revision: "A",
      lines: [{ itemType: "MATERIAL", itemId: rawMaterialId, qtyPer: 1, unit: "KG" }],
    }));
    const recipe = await auth(api().post("/recipes").send({ partId, revision: "A", steps: [{ seq: 1, name: "NC operasyonu" }] }));
    await auth(api().patch(`/parts/${partId}/engineering-status`).send({ status: "RELEASED" })).expect(200);
    await auth(api().patch(`/boms/${bom.body.id}/status`).send({ status: "RELEASED" })).expect(200);
    await auth(api().patch(`/recipes/${recipe.body.id}/status`).send({ status: "RELEASED" })).expect(200);
    const definition = await auth(api().post("/production-definitions").send({
      plantId, partId, bomHeaderId: bom.body.id, recipeHeaderId: recipe.body.id,
    }));
    await auth(api().patch(`/production-definitions/${definition.body.id}/status`).send({ status: "RELEASED" })).expect(200);
    const created = await auth(
      api()
        .post("/work-orders")
        .send({ partId, quantity: 10, dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString() }),
    );
    const released = await auth(api().post(`/work-orders/${created.body.id}/release-engineering`).send({
      plantId, productionDefinitionId: definition.body.id,
    })).expect(201);
    workOrderId = released.body.id;
    const operationId = released.body.operations[0].id;
    runId = (await auth(api().post(`/work-orders/${workOrderId}/runs`).send({ operationId }))).body.id;
  });

  afterAll(async () => {
    await prisma.nonConformance.deleteMany({ where: { workOrderId } });
    await prisma.productionRun.deleteMany({ where: { workOrderId } });
    await prisma.workOrderCostBaseline.deleteMany({ where: { workOrderId } });
    await prisma.workOrder.deleteMany({ where: { id: workOrderId } });
    await prisma.productionDefinition.deleteMany({ where: { partId } });
    await prisma.bomHeader.deleteMany({ where: { partId } });
    await prisma.recipeHeader.deleteMany({ where: { partId } });
    await prisma.part.deleteMany({ where: { id: partId } });
    await app.close();
  });

  it("üretim adedi girişi NC yokken serbesttir", async () => {
    await auth(api().patch(`/runs/${runId}`).send({ goodCount: 2 })).expect(200);
  });

  it("NC oluşturulur (OPEN)", async () => {
    const res = await auth(
      api()
        .post("/non-conformances")
        .send({ workOrderId, productionRunId: runId, failureType: "Yüzey çizik", actionType: "SCRAP" }),
    ).expect(201);
    ncId = res.body.id;
    expect(res.body.status).toBe("OPEN");
  });

  it("açık NC varken üretim adedi girişi 409 döner", async () => {
    await auth(api().patch(`/runs/${runId}`).send({ goodCount: 3 })).expect(409);
  });

  it("scrapCount/downtimeNote gibi diğer alanlar NC açıkken de güncellenebilir", async () => {
    await auth(api().patch(`/runs/${runId}`).send({ scrapCount: 1 })).expect(200);
  });

  it("NC kapatılırken resolutionNote zorunludur (400)", async () => {
    await auth(api().patch(`/non-conformances/${ncId}/resolve`).send({ status: "RESOLVED" })).expect(400);
  });

  it("NC kapatılınca (RESOLVED) üretim adedi girişi tekrar serbest kalır", async () => {
    await auth(
      api()
        .patch(`/non-conformances/${ncId}/resolve`)
        .send({ status: "RESOLVED", resolutionNote: "3 adet hurdaya ayrıldı, kalan kabul edildi" }),
    ).expect(200);
    await auth(api().patch(`/runs/${runId}`).send({ goodCount: 4 })).expect(200);
  });

  it("listeleme workOrderId'ye göre filtrelenebilir", async () => {
    const res = await auth(api().get(`/non-conformances?workOrderId=${workOrderId}`)).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].status).toBe("RESOLVED");
  });
});
