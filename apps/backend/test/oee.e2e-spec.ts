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
      await auth(
        api()
          .post("/parts")
          .send({ partNo: `OEE-${STAMP}`, revision: "A", name: "OEE Testi", idealCycleTimeSec: 10 }),
      )
    ).body.id;
    workOrderId = (
      await auth(
        api()
          .post("/work-orders")
          .send({ partId, quantity: 100, dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString() }),
      )
    ).body.id;
    runId = (await auth(api().post(`/work-orders/${workOrderId}/runs`).send({}))).body.id;
  });

  afterAll(async () => {
    await prisma.productionRun.deleteMany({ where: { workOrderId } });
    await prisma.workOrder.deleteMany({ where: { id: workOrderId } });
    await prisma.part.deleteMany({ where: { id: partId } });
    await app.close();
  });

  it("idealCycleTimeSec yokken performance/oee null döner, quality hesaplanır", async () => {
    const partNoIdeal = (
      await auth(api().post("/parts").send({ partNo: `OEE-NOIDEAL-${STAMP}`, revision: "A", name: "İdealsiz" }))
    ).body.id;
    const woNoIdeal = (
      await auth(
        api()
          .post("/work-orders")
          .send({
            partId: partNoIdeal,
            quantity: 10,
            dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
          }),
      )
    ).body.id;
    await auth(api().post(`/work-orders/${woNoIdeal}/runs`).send({}));

    const res = await auth(api().get(`/work-orders/${woNoIdeal}/oee`)).expect(200);
    expect(res.body.performance).toBeNull();
    expect(res.body.oee).toBeNull();
    expect(res.body.availability).toBeNull();

    await prisma.productionRun.deleteMany({ where: { workOrderId: woNoIdeal } });
    await prisma.workOrder.deleteMany({ where: { id: woNoIdeal } });
    await prisma.part.deleteMany({ where: { id: partNoIdeal } });
  });

  it("goodCount/scrapCount girilince quality doğru hesaplanır", async () => {
    await auth(api().patch(`/runs/${runId}`).send({ goodCount: 8, scrapCount: 2 })).expect(200);
    const res = await auth(api().get(`/work-orders/${workOrderId}/oee`)).expect(200);
    expect(res.body.quality).toBeCloseTo(0.8, 2);
    expect(res.body.goodCount).toBe(8);
    expect(res.body.scrapCount).toBe(2);
  });

  it("idealCycleTimeSec varken performance ve oee hesaplanır (0-1 arası)", async () => {
    const res = await auth(api().get(`/work-orders/${workOrderId}/oee`)).expect(200);
    expect(res.body.performance).not.toBeNull();
    expect(res.body.performance).toBeGreaterThanOrEqual(0);
    expect(res.body.performance).toBeLessThanOrEqual(1);
    expect(res.body.oee).toBeCloseTo(res.body.quality * res.body.performance, 5);
  });

  it("olmayan iş emri için 404 döner", async () => {
    await auth(api().get("/work-orders/00000000-0000-0000-0000-000000000099/oee")).expect(404);
  });
});
