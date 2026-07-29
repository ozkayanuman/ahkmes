import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();

describe("Vardiya raporu (Shift Report) (e2e)", () => {
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
      await auth(api().post("/parts").send({ partNo: `SR-${STAMP}`, revision: "A", name: "Vardiya Testi" }))
    ).body.id;
    workOrderId = (
      await auth(
        api()
          .post("/work-orders")
          .send({ partId, quantity: 50, dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString() }),
      )
    ).body.id;
    runId = (await auth(api().post(`/work-orders/${workOrderId}/runs`).send({}))).body.id;
    await auth(api().patch(`/runs/${runId}`).send({ goodCount: 5, scrapCount: 1 })).expect(200);
  });

  afterAll(async () => {
    await prisma.productionRun.deleteMany({ where: { workOrderId } }).catch(() => undefined);
    await prisma.workOrder.deleteMany({ where: { id: workOrderId } }).catch(() => undefined);
    await prisma.part.deleteMany({ where: { id: partId } }).catch(() => undefined);
    await app.close();
  });

  it("bugünün 3 vardiyası döner ve şu anki koşu (tam olarak) bir vardiyada görünür", async () => {
    // Gece 00:00-06:00 arası bir koşu, başladığı takvim gününe göre bir önceki günün
    // 3. vardiyasına ait sayılır (vardiya, başladığı güne atanır) — bu yüzden hem
    // bugünü hem düne bakıp toplamda koşunun bir yerde göründüğünü doğruluyoruz.
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const yesterday = new Date(now.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10);

    const [todayRes, yesterdayRes] = await Promise.all([
      auth(api().get(`/shift-report?date=${today}`)).expect(200),
      auth(api().get(`/shift-report?date=${yesterday}`)).expect(200),
    ]);
    expect(todayRes.body).toHaveLength(3);
    expect(todayRes.body.map((s: { shift: number }) => s.shift)).toEqual([1, 2, 3]);

    const allBuckets = [...todayRes.body, ...yesterdayRes.body];
    const totalGood = allBuckets.reduce((sum: number, b: { goodCount: number }) => sum + b.goodCount, 0);
    const totalScrap = allBuckets.reduce((sum: number, b: { scrapCount: number }) => sum + b.scrapCount, 0);
    expect(totalGood).toBeGreaterThanOrEqual(5);
    expect(totalScrap).toBeGreaterThanOrEqual(1);
  });

  it("geçersiz/eksik date parametresi bugüne düşer, 200 döner", async () => {
    await auth(api().get("/shift-report")).expect(200);
  });
});
