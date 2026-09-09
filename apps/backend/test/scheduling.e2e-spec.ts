import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();

/**
 * AHK-011 (daraltılmış dilim) — standart süre snapshot'ı ve günlük kapasite
 * yük/aşım görünürlüğü. Gerçek finite scheduling değil: bir iş emrinin
 * standardMinutes toplamı planlanan pencereye eşit dağıtılır.
 */
describe("AHK-011 — standart süre + kapasite yükü (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let partId: string;
  let machineId: string;
  let workOrderId: string;

  const auth = (r: request.Test) => r.set("Authorization", `Bearer ${adminToken}`);
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    adminToken = (await api().post("/auth/login").send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).body.accessToken;

    partId = (await auth(api().post("/parts").send({ partNo: `SCH-${STAMP}`, revision: "A", name: "Kapasite Testi" }))).body.id;
    machineId = (await auth(api().post("/machines").send({ name: `Kapasite Tezgah ${STAMP}`, model: "Test" }))).body.id;
    await auth(api().patch(`/machines/${machineId}`).send({ dailyCapacityMinutes: 480 })).expect(200);

    await auth(
      api().post("/recipes").send({
        partId,
        revision: "A",
        steps: [{ seq: 1, name: "Tornalama", standardMinutes: 100 }],
      }),
    ).expect(201);

    const wo = await auth(
      api().post("/work-orders").send({
        partId,
        machineId,
        quantity: 1,
        dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      }),
    ).expect(201);
    workOrderId = wo.body.id;
  });

  afterAll(async () => {
    await prisma.workOrderOperation.deleteMany({ where: { workOrderId } }).catch(() => undefined);
    await prisma.workOrder.deleteMany({ where: { id: workOrderId } }).catch(() => undefined);
    await prisma.recipeHeader.deleteMany({ where: { partId } }).catch(() => undefined);
    await prisma.machine.deleteMany({ where: { id: machineId } }).catch(() => undefined);
    await prisma.part.deleteMany({ where: { id: partId } }).catch(() => undefined);
    await app.close();
  });

  it("recipe'nin standardMinutes'i WorkOrderOperation'a immutable snapshot olarak kopyalanır", async () => {
    const operations = await auth(api().get(`/work-orders/${workOrderId}/operations`)).expect(200);
    expect(operations.body).toHaveLength(1);
    expect(Number(operations.body[0].standardMinutes)).toBe(100);
  });

  it("kapasite endpoint'i planlanan pencereye eşit dağıtılmış yükü döner, aşımı işaretler", async () => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);

    await auth(
      api().patch(`/work-orders/${workOrderId}/schedule`).send({
        plannedStartDate: from.toISOString(),
        plannedEndDate: to.toISOString(),
      }),
    ).expect(200);

    const capacity = await auth(
      api().get(`/scheduling/capacity?from=${from.toISOString()}&to=${to.toISOString()}`),
    ).expect(200);

    const rows = capacity.body.filter((r: { machineId: string }) => r.machineId === machineId);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.loadMinutes).toBe(50);
      expect(row.capacityMinutes).toBe(480);
      expect(row.overloaded).toBe(false);
    }
  });

  it("dailyCapacityMinutes'i aşan bir yük overloaded:true döner", async () => {
    const bigMachine = (await auth(api().post("/machines").send({ name: `Aşım Tezgah ${STAMP}`, model: "Test" }))).body.id;
    await auth(api().patch(`/machines/${bigMachine}`).send({ dailyCapacityMinutes: 10 })).expect(200);

    const bigPart = (await auth(api().post("/parts").send({ partNo: `SCH-BIG-${STAMP}`, revision: "A", name: "Aşım Parça" }))).body.id;
    await auth(
      api().post("/recipes").send({ partId: bigPart, revision: "A", steps: [{ seq: 1, name: "Freze", standardMinutes: 500 }] }),
    ).expect(201);

    const day = new Date();
    day.setHours(0, 0, 0, 0);
    const bigWo = await auth(
      api().post("/work-orders").send({
        partId: bigPart,
        machineId: bigMachine,
        quantity: 1,
        dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      }),
    ).expect(201);
    await auth(
      api().patch(`/work-orders/${bigWo.body.id}/schedule`).send({
        plannedStartDate: day.toISOString(),
        plannedEndDate: day.toISOString(),
      }),
    ).expect(200);

    const capacity = await auth(
      api().get(`/scheduling/capacity?from=${day.toISOString()}&to=${day.toISOString()}`),
    ).expect(200);
    const row = capacity.body.find((r: { machineId: string }) => r.machineId === bigMachine);
    expect(row).toMatchObject({ loadMinutes: 500, capacityMinutes: 10, overloaded: true });

    await prisma.workOrderOperation.deleteMany({ where: { workOrderId: bigWo.body.id } });
    await prisma.workOrder.deleteMany({ where: { id: bigWo.body.id } });
    await prisma.recipeHeader.deleteMany({ where: { partId: bigPart } });
    await prisma.machine.deleteMany({ where: { id: bigMachine } });
    await prisma.part.deleteMany({ where: { id: bigPart } });
  });
});
