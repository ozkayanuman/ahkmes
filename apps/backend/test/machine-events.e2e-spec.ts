import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();

describe("Machine Connector — telemetri (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let partId: string;
  let machineId: string;
  let workOrderId: string;
  let machineKey: string;

  const auth = (r: request.Test) => r.set("Authorization", `Bearer ${adminToken}`);
  const api = () => request(app.getHttpServer());
  const withKey = (r: request.Test) => r.set("X-Machine-Key", machineKey);

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
      await auth(
        api().post("/parts").send({ partNo: `MC-${STAMP}`, revision: "A", name: "Konnektör Testi" }),
      )
    ).body.id;
    machineId = (
      await auth(api().post("/machines").send({ name: `MC Tezgah ${STAMP}`, model: "Test" }))
    ).body.id;
    workOrderId = (
      await auth(
        api()
          .post("/work-orders")
          .send({
            partId,
            quantity: 10,
            dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
            machineId,
          }),
      )
    ).body.id;

    const keyRes = await auth(api().post(`/machines/${machineId}/connector-key`)).expect(201);
    machineKey = keyRes.body.key;
  });

  afterAll(async () => {
    await prisma.productionRun.deleteMany({ where: { workOrderId } }).catch(() => undefined);
    await prisma.workOrder.deleteMany({ where: { id: workOrderId } }).catch(() => undefined);
    await prisma.machine.deleteMany({ where: { id: machineId } }).catch(() => undefined);
    await prisma.part.deleteMany({ where: { id: partId } }).catch(() => undefined);
    await app.close();
  });

  it("geçersiz makine anahtarı 401 döner", async () => {
    await api()
      .post(`/machines/${machineId}/telemetry`)
      .set("X-Machine-Key", "yanlis-anahtar")
      .send({ type: "CYCLE_START" })
      .expect(401);
  });

  it("olmayan machineId 401 döner (makine bulunamaz)", async () => {
    await withKey(
      api().post(`/machines/00000000-0000-0000-0000-000000000099/telemetry`).send({ type: "IDLE" }),
    ).expect(401);
  });

  it("aktif iş emri atanmamışken CYCLE_START 409 döner", async () => {
    await withKey(api().post(`/machines/${machineId}/telemetry`).send({ type: "CYCLE_START" })).expect(
      409,
    );
  });

  it("aktif iş emri atanınca CYCLE_START ile ProductionRun(source=MACHINE) oluşur, WO IN_PRODUCTION olur", async () => {
    await auth(
      api().patch(`/machines/${machineId}/active-work-order`).send({ workOrderId }),
    ).expect(200);

    await withKey(api().post(`/machines/${machineId}/telemetry`).send({ type: "CYCLE_START" })).expect(
      201,
    );

    const wo = await auth(api().get(`/work-orders/${workOrderId}`)).expect(200);
    expect(wo.body.status).toBe("IN_PRODUCTION");

    const runs = await prisma.productionRun.findMany({ where: { workOrderId } });
    expect(runs).toHaveLength(1);
    expect(runs[0].source).toBe("MACHINE");
    expect(runs[0].endedAt).toBeNull();
  });

  it("PART_COMPLETE ile goodCount artar", async () => {
    await withKey(
      api().post(`/machines/${machineId}/telemetry`).send({ type: "PART_COMPLETE" }),
    ).expect(201);
    await withKey(
      api().post(`/machines/${machineId}/telemetry`).send({ type: "PART_COMPLETE" }),
    ).expect(201);

    const run = await prisma.productionRun.findFirst({ where: { workOrderId } });
    expect(run?.goodCount).toBe(2);
  });

  it("ALARM ile downtimeNote güncellenir", async () => {
    await withKey(
      api()
        .post(`/machines/${machineId}/telemetry`)
        .send({ type: "ALARM", payload: { message: "Spindle aşırı yük" } }),
    ).expect(201);

    const run = await prisma.productionRun.findFirst({ where: { workOrderId } });
    expect(run?.downtimeNote).toBe("Spindle aşırı yük");
  });

  it("tekrar CYCLE_START gönderilirse ikinci bir run açılmaz (idempotent)", async () => {
    await withKey(api().post(`/machines/${machineId}/telemetry`).send({ type: "CYCLE_START" })).expect(
      201,
    );
    const runs = await prisma.productionRun.findMany({ where: { workOrderId } });
    expect(runs).toHaveLength(1);
  });
});
