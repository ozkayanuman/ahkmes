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
  let recipeId = "";
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
    machineOneId = (await auth(api().post("/machines").send({ name: `Rota MCV 1 ${STAMP}`, model: "MCV-5500" }))).body.id;
    machineTwoId = (await auth(api().post("/machines").send({ name: `Rota MCV 2 ${STAMP}`, model: "MCV-5500" }))).body.id;
  });

  afterAll(async () => {
    if (workOrderId) {
      await prisma.productionRun.deleteMany({ where: { workOrderId } }).catch(() => undefined);
      await prisma.workOrder.deleteMany({ where: { id: workOrderId } }).catch(() => undefined);
    }
    if (recipeId) await prisma.recipeHeader.deleteMany({ where: { id: recipeId } }).catch(() => undefined);
    if (machineOneId || machineTwoId) await prisma.machine.deleteMany({ where: { id: { in: [machineOneId, machineTwoId].filter(Boolean) } } }).catch(() => undefined);
    if (partId) await prisma.part.deleteMany({ where: { id: partId } }).catch(() => undefined);
    await app.close();
  });

  it("aktif Recipe'yi iş emrine bağımsız, revizyonlu operasyon snapshot olarak kopyalar", async () => {
    const recipe = await auth(api().post("/recipes").send({
      partId,
      revision: "R1",
      steps: [
        { seq: 10, name: "Kaba işleme", parameterName: "Devir", parameterValue: "4500", unit: "rpm" },
        { seq: 20, name: "Finiş işleme", parameterName: "Devir", parameterValue: "7000", unit: "rpm" },
      ],
    })).expect(201);
    recipeId = recipe.body.id;

    const created = await auth(api().post("/work-orders").send({
      partId,
      quantity: 10,
      dueDate: new Date(Date.now() + 86400000).toISOString(),
    })).expect(201);
    workOrderId = created.body.id;
    expect(created.body.recipeRevision).toBe("R1");
    expect(created.body.operations.map((operation: { seq: number; name: string }) => [operation.seq, operation.name]))
      .toEqual([[10, "Kaba işleme"], [20, "Finiş işleme"]]);

    await auth(api().patch(`/recipes/${recipeId}`).send({
      steps: [{ seq: 10, name: "Sonradan değişen rota" }],
    })).expect(200);
    const frozen = await auth(api().get(`/work-orders/${workOrderId}`)).expect(200);
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
