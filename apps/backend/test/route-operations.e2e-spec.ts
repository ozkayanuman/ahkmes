import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();

describe("AHK-004 — iş emri rota snapshot ve operasyon/WIP", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let partId = "";
  let plantId = "";
  let rawMaterialId = "";
  let recipeId = "";
  let recipeTwoId = "";
  let workOrderId = "";
  let machineOneId = "";
  let machineTwoId = "";
  let runOneId = "";
  let runTwoId = "";

  const api = () => request(app.getHttpServer());
  const auth = (test: request.Test) => test.set("Authorization", `Bearer ${adminToken}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    const login = await api().post("/auth/login").send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    adminToken = login.body.accessToken;

    partId = (await auth(api().post("/parts").send({ partNo: `ROUTE-${STAMP}`, revision: "A", name: "Rota Test Parçası" }))).body.id;
    plantId = (await auth(api().post("/hierarchy/plants").send({ name: `Rota Plant ${STAMP}` }))).body.id;
    rawMaterialId = (await auth(api().post("/materials").send({ code: `ROUTE-RAW-${STAMP}`, name: "Rota Hammadde", type: "RAW", unit: "KG" }))).body.id;
    machineOneId = (await auth(api().post("/machines").send({ name: `Rota MCV 1 ${STAMP}`, model: "MCV-5500" }))).body.id;
    machineTwoId = (await auth(api().post("/machines").send({ name: `Rota MCV 2 ${STAMP}`, model: "MCV-5500" }))).body.id;
  });

  afterAll(async () => {
    if (workOrderId) {
      await prisma.productionRun.deleteMany({ where: { workOrderId } }).catch(() => undefined);
      await prisma.workOrderCostBaseline.deleteMany({ where: { workOrderId } }).catch(() => undefined);
      await prisma.workOrder.deleteMany({ where: { id: workOrderId } }).catch(() => undefined);
    }
    if (partId) {
      await prisma.productionDefinition.deleteMany({ where: { partId } }).catch(() => undefined);
      await prisma.bomHeader.deleteMany({ where: { partId } }).catch(() => undefined);
      await prisma.recipeHeader.deleteMany({ where: { partId } }).catch(() => undefined);
    }
    if (machineOneId || machineTwoId) await prisma.machine.deleteMany({ where: { id: { in: [machineOneId, machineTwoId].filter(Boolean) } } }).catch(() => undefined);
    if (partId) await prisma.part.deleteMany({ where: { id: partId } }).catch(() => undefined);
    if (rawMaterialId) await prisma.material.deleteMany({ where: { id: rawMaterialId } }).catch(() => undefined);
    if (plantId) await prisma.plant.deleteMany({ where: { id: plantId } }).catch(() => undefined);
    await app.close();
  });

  /** BOM+Recipe+ProductionDefinition zincirini yayınlar; CNC-V1-01'den beri
   * operasyonlar yalnızca açık `release-engineering` komutuyla dolar. */
  async function releasedDefinition(revision: string, steps: Array<Record<string, unknown>>) {
    const bom = await auth(api().post("/boms").send({
      partId, revision,
      lines: [{ itemType: "MATERIAL", itemId: rawMaterialId, qtyPer: 1, unit: "KG" }],
    })).expect(201);
    const recipe = await auth(api().post("/recipes").send({ partId, revision, steps })).expect(201);
    await auth(api().patch(`/parts/${partId}/engineering-status`).send({ status: "RELEASED" })).expect(200);
    await auth(api().patch(`/boms/${bom.body.id}/status`).send({ status: "RELEASED" })).expect(200);
    await auth(api().patch(`/recipes/${recipe.body.id}/status`).send({ status: "RELEASED" })).expect(200);
    const definition = await auth(api().post("/production-definitions").send({
      plantId, partId, bomHeaderId: bom.body.id, recipeHeaderId: recipe.body.id,
    })).expect(201);
    await auth(api().patch(`/production-definitions/${definition.body.id}/status`).send({ status: "RELEASED" })).expect(200);
    return { bomId: bom.body.id, recipeId: recipe.body.id, definitionId: definition.body.id };
  }

  it("aktif Recipe'yi iş emrine bağımsız, revizyonlu operasyon snapshot olarak kopyalar", async () => {
    const r1 = await releasedDefinition("R1", [
      { seq: 1, name: "Kaba işleme", parameterName: "Devir", parameterValue: "4500", unit: "rpm" },
      { seq: 2, name: "Finiş işleme", parameterName: "Devir", parameterValue: "7000", unit: "rpm" },
    ]);
    recipeId = r1.recipeId;

    const created = await auth(api().post("/work-orders").send({
      partId,
      quantity: 10,
      dueDate: new Date(Date.now() + 86400000).toISOString(),
    })).expect(201);
    workOrderId = created.body.id;
    expect(created.body.recipeRevision).toBeNull();
    expect(created.body.operations).toHaveLength(0);

    const released = await auth(api().post(`/work-orders/${workOrderId}/release-engineering`).send({
      plantId, productionDefinitionId: r1.definitionId,
    })).expect(201);
    expect(released.body.recipeRevision).toBe("R1");
    expect(released.body.operations.map((operation: { seq: number; name: string }) => [operation.seq, operation.name]))
      .toEqual([[1, "Kaba işleme"], [2, "Finiş işleme"]]);

    // Released routing/BOM/production-definition kayıtları artık immutable;
    // bir sonraki revizyonu yayınlamak, önceki iş emrinin dondurulmuş
    // snapshot'ını değiştirmediğini kanıtlar.
    const r2 = await releasedDefinition("R2", [{ seq: 1, name: "Sonradan değişen rota" }]);
    recipeTwoId = r2.recipeId;
    const frozen = await auth(api().get(`/work-orders/${workOrderId}`)).expect(200);
    expect(frozen.body.recipeRevision).toBe("R1");
    expect(frozen.body.operations.map((operation: { name: string }) => operation.name))
      .toEqual(["Kaba işleme", "Finiş işleme"]);
  });

  it("makine atamasını korur, operasyon sırasını zorlar ve WIP'yi koşulardan türetir", async () => {
    let operations = (await auth(api().get(`/work-orders/${workOrderId}/operations`)).expect(200)).body;
    const [first, second] = operations;
    await auth(api().patch(`/work-orders/${workOrderId}/operations/${first.id}`).send({ machineId: machineOneId })).expect(200);

    await auth(api().post(`/work-orders/${workOrderId}/runs`).send({ operationId: second.id })).expect(409);
    await auth(api().post(`/work-orders/${workOrderId}/runs`).send({ operationId: first.id, machineId: machineTwoId })).expect(409);

    const runOne = await auth(api().post(`/work-orders/${workOrderId}/runs`).send({ operationId: first.id })).expect(201);
    runOneId = runOne.body.id;
    expect(runOne.body.machine.id).toBe(machineOneId);
    await auth(api().patch(`/runs/${runOneId}`).send({ goodCount: 6, scrapCount: 1 })).expect(200);
    await auth(api().post(`/runs/${runOneId}/complete`).send({})).expect(201);

    operations = (await auth(api().get(`/work-orders/${workOrderId}/operations`)).expect(200)).body;
    expect(Number(operations[0].completedQty)).toBe(6);
    expect(Number(operations[0].scrapQty)).toBe(1);
    expect(operations[0].status).toBe("IN_PROGRESS");
    await auth(api().post(`/work-orders/${workOrderId}/operations/${first.id}/complete`).send({})).expect(201);

    const runTwo = await auth(api().post(`/work-orders/${workOrderId}/runs`).send({ operationId: second.id, machineId: machineTwoId })).expect(201);
    runTwoId = runTwo.body.id;
    await auth(api().post(`/runs/${runTwoId}/complete`).send({ goodCount: 6 })).expect(201);
    await auth(api().post(`/work-orders/${workOrderId}/operations/${second.id}/complete`).send({})).expect(201);
    await auth(api().patch(`/work-orders/${workOrderId}/status`).send({ status: "COMPLETED" })).expect(200);
  });
});
