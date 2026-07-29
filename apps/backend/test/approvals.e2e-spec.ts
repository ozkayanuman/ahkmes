import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();
const TEST_ENTITY_ID = randomUUID();

describe("Approval Engine (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let salesToken: string;
  let salesUserId: string;
  let requestId: string;

  const admin = (r: request.Test) => r.set("Authorization", `Bearer ${adminToken}`);
  const sales = (r: request.Test) => r.set("Authorization", `Bearer ${salesToken}`);
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

    const salesEmail = `approval-sales-${STAMP}@ahkmes.local`;
    const created = await admin(
      api().post("/users").send({ email: salesEmail, password: "Sales1234!", name: "Onay Test Satış", role: "SALES" }),
    );
    salesUserId = created.body.id;
    const salesLogin = await api().post("/auth/login").send({ email: salesEmail, password: "Sales1234!" });
    salesToken = salesLogin.body.accessToken;
  });

  afterAll(async () => {
    await prisma.approvalRequest.deleteMany({ where: { requestedById: salesUserId } }).catch(() => undefined);
    await prisma.notification.deleteMany({ where: { userId: salesUserId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: salesUserId } }).catch(() => undefined);
    await app.close();
  });

  it("SALES bir onay talebi oluşturabilir (PENDING)", async () => {
    const res = await sales(
      api()
        .post("/approvals")
        .send({ entity: "test-entity", entityId: TEST_ENTITY_ID, requiredRoles: ["ADMIN"], note: "test talebi" }),
    ).expect(201);
    requestId = res.body.id;
    expect(res.body.status).toBe("PENDING");
  });

  it("SALES kendi talebini karara bağlayamaz (403 — ADMIN gerekir)", async () => {
    await sales(api().patch(`/approvals/${requestId}/approve`).send({})).expect(403);
  });

  it("ADMIN onaylayınca durum APPROVED olur ve talep eden bildirim alır", async () => {
    const res = await admin(api().patch(`/approvals/${requestId}/approve`).send({ note: "uygun" })).expect(200);
    expect(res.body.status).toBe("APPROVED");

    const notifs = await sales(api().get("/notifications")).expect(200);
    const found = notifs.body.find((n: { type: string; entityId: string }) => n.entityId === TEST_ENTITY_ID);
    expect(found).toBeDefined();
    expect(found.type).toBe("APPROVAL_GRANTED");
  });

  it("karara bağlanmış talep tekrar onaylanamaz (409)", async () => {
    await admin(api().patch(`/approvals/${requestId}/approve`).send({})).expect(409);
  });

  it("GET /approvals?status=APPROVED listede görünür", async () => {
    const res = await admin(api().get("/approvals?status=APPROVED")).expect(200);
    expect(res.body.some((r: { id: string }) => r.id === requestId)).toBe(true);
  });
});
