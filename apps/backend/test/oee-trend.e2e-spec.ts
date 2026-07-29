import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();

describe("OEE trend & duruş (downtime) Pareto (e2e)", () => {
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
        api().post("/parts").send({ partNo: `OEET-${STAMP}`, revision: "A", name: "OEE Trend Testi" }),
      )
    ).body.id;
    machineId = (
      await auth(api().post("/machines").send({ name: `OEET Tezgah ${STAMP}`, model: "Test" }))
    ).body.id;
    workOrderId = (
      await auth(
        api()
          .post("/work-orders")
          .send({
            partId,
            quantity: 100,
            dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
            machineId,
          }),
      )
    ).body.id;
    const keyRes = await auth(api().post(`/machines/${machineId}/connector-key`)).expect(201);
    machineKey = keyRes.body.key;

    await auth(api().patch(`/machines/${machineId}/active-work-order`).send({ workOrderId })).expect(200);
    await withKey(api().post(`/machines/${machineId}/telemetry`).send({ type: "CYCLE_START" })).expect(201);
    await withKey(
      api()
        .post(`/machines/${machineId}/telemetry`)
        .send({ type: "ALARM", payload: { message: "Takım kırılması" } }),
    ).expect(201);
    // Downtime hesaplaması ALARM ile bir sonraki olay arasındaki gerçek süreye
    // dayanır (saniyeye yuvarlanır) — ölçülebilir bir süre geçsin diye kısa bekleme.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await withKey(api().post(`/machines/${machineId}/telemetry`).send({ type: "PART_COMPLETE" })).expect(
      201,
    );
  });

  afterAll(async () => {
    await prisma.machineStatusEvent.deleteMany({ where: { machineId } }).catch(() => undefined);
    await prisma.productionRun.deleteMany({ where: { workOrderId } }).catch(() => undefined);
    await prisma.workOrder.deleteMany({ where: { id: workOrderId } }).catch(() => undefined);
    await prisma.machine.deleteMany({ where: { id: machineId } }).catch(() => undefined);
    await prisma.part.deleteMany({ where: { id: partId } }).catch(() => undefined);
    await app.close();
  });

  it("her telemetri olayı MachineStatusEvent olarak kalıcı kaydedilir", async () => {
    const events = await prisma.machineStatusEvent.findMany({
      where: { machineId },
      orderBy: { occurredAt: "asc" },
    });
    expect(events.map((e) => e.type)).toEqual(["CYCLE_START", "ALARM", "PART_COMPLETE"]);
    expect(events[1].message).toBe("Takım kırılması");
  });

  it("GET /oee/trend bugünün gününde koşu verisini içerir", async () => {
    const res = await auth(api().get("/oee/trend?days=1")).expect(200);
    const today = new Date().toISOString().slice(0, 10);
    const bucket = res.body.find((b: { date: string }) => b.date === today);
    expect(bucket).toBeDefined();
    expect(bucket.goodCount).toBeGreaterThanOrEqual(1);
    expect(bucket.downtimeSeconds).toBeGreaterThan(0);
  });

  it("GET /oee/downtime-pareto ALARM nedenini süreye göre döner", async () => {
    const res = await auth(api().get("/oee/downtime-pareto?days=1")).expect(200);
    const reason = res.body.find((r: { reason: string }) => r.reason === "Takım kırılması");
    expect(reason).toBeDefined();
    expect(reason.totalSeconds).toBeGreaterThan(0);
    expect(reason.count).toBe(1);
  });
});
