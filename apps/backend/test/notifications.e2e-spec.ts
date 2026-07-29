import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();

describe("Notification Engine (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let partId: string;
  let workOrderId: string;
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
      await auth(api().post("/parts").send({ partNo: `NOTIF-${STAMP}`, revision: "A", name: "Bildirim Testi" }))
    ).body.id;
    workOrderId = (
      await auth(
        api()
          .post("/work-orders")
          .send({ partId, quantity: 5, dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString() }),
      )
    ).body.id;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { entityId: ncId } }).catch(() => undefined);
    await prisma.nonConformance.deleteMany({ where: { workOrderId } });
    await prisma.workOrder.deleteMany({ where: { id: workOrderId } });
    await prisma.part.deleteMany({ where: { id: partId } });
    await app.close();
  });

  it("Uygunsuzluk oluşturulunca ADMIN'e bildirim düşer", async () => {
    const ncRes = await auth(
      api()
        .post("/non-conformances")
        .send({ workOrderId, failureType: "BOYUT", description: "Bildirim testi uygunsuzluğu" }),
    ).expect(201);
    ncId = ncRes.body.id;

    const list = await auth(api().get("/notifications")).expect(200);
    const found = list.body.find(
      (n: { type: string; entityId: string }) => n.type === "NON_CONFORMANCE_CREATED" && n.entityId === ncId,
    );
    expect(found).toBeDefined();
    expect(found.isRead).toBe(false);
  });

  it("GET /notifications/unread-count okunmamış sayıyı doğru döner", async () => {
    const before = await auth(api().get("/notifications/unread-count")).expect(200);
    expect(before.body.count).toBeGreaterThan(0);
  });

  it("PATCH /notifications/:id/read tek bildirimi okunmuş yapar", async () => {
    const list = await auth(api().get("/notifications")).expect(200);
    const target = list.body.find((n: { entityId: string }) => n.entityId === ncId);
    expect(target).toBeDefined();

    await auth(api().patch(`/notifications/${target.id}/read`)).expect(200);

    const after = await auth(api().get("/notifications")).expect(200);
    const updated = after.body.find((n: { id: string }) => n.id === target.id);
    expect(updated.isRead).toBe(true);
  });

  it("başka bir kullanıcının bildirimlerini göremez", async () => {
    const opEmail = `notif-op-${STAMP}@ahkmes.local`;
    const created = await auth(
      api().post("/users").send({ email: opEmail, password: "Operator1234!", name: "Bildirim Operatör", role: "OPERATOR" }),
    );
    const opLogin = await api().post("/auth/login").send({ email: opEmail, password: "Operator1234!" });
    const opToken = opLogin.body.accessToken;

    const res = await api().get("/notifications").set("Authorization", `Bearer ${opToken}`).expect(200);
    const leaked = res.body.find((n: { entityId: string }) => n.entityId === ncId);
    expect(leaked).toBeUndefined();

    await prisma.user.deleteMany({ where: { id: created.body.id } }).catch(() => undefined);
  });
});
