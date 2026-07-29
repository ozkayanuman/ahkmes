import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();

describe("Denetim izi (Audit Log) (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let operatorToken: string;
  let operatorUserId: string;
  let customerId: string;

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

    const opEmail = `audit-op-${STAMP}@ahkmes.local`;
    const created = await auth(
      api().post("/users").send({ email: opEmail, password: "Operator1234!", name: "Audit Operatör", role: "OPERATOR" }),
    );
    operatorUserId = created.body.id;
    const opLogin = await api().post("/auth/login").send({ email: opEmail, password: "Operator1234!" });
    operatorToken = opLogin.body.accessToken;

    const customerRes = await auth(
      api().post("/customers").send({ name: `Audit Test Müşteri ${STAMP}` }),
    ).expect(201);
    customerId = customerRes.body.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: customerId } }).catch(() => undefined);
    await prisma.customer.deleteMany({ where: { id: customerId } }).catch(() => undefined);
    if (operatorUserId) await prisma.user.deleteMany({ where: { id: operatorUserId } }).catch(() => undefined);
    await app.close();
  });

  it("müşteri oluşturma isteği AuditLog'a CREATE olarak kaydedilir", async () => {
    const res = await auth(api().get(`/audit-log?entity=customers&entityId=${customerId}`)).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    const entry = res.body.find((e: { action: string; entityId: string }) => e.entityId === customerId);
    expect(entry).toBeDefined();
    expect(entry.action).toBe("CREATE");
    expect(entry.user.name).toBeDefined();
  });

  it("GET /audit-log/entities bu tenant'ta gerçekten kayıt olan varlıkları döner", async () => {
    const res = await auth(api().get("/audit-log/entities")).expect(200);
    expect(res.body).toContain("customers");
  });

  it("ADMIN olmayan rol audit-log'a erişemez (403)", async () => {
    await api()
      .get("/audit-log")
      .set("Authorization", `Bearer ${operatorToken}`)
      .expect(403);
  });

  it("AuditLog kaydı doğrudan SQL ile UPDATE edilemez (DB trigger)", async () => {
    const [row] = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM "AuditLog" WHERE "entityId" = $1 LIMIT 1`,
      customerId,
    );
    expect(row).toBeDefined();

    await expect(
      prisma.$executeRawUnsafe(`UPDATE "AuditLog" SET action = 'UPDATE' WHERE id = $1`, row.id),
    ).rejects.toThrow(/immutable audit trail/);
  });

  it("AuditLog kaydı doğrudan SQL ile DELETE edilemez (DB trigger)", async () => {
    const [row] = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM "AuditLog" WHERE "entityId" = $1 LIMIT 1`,
      customerId,
    );
    expect(row).toBeDefined();

    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "AuditLog" WHERE id = $1`, row.id),
    ).rejects.toThrow(/immutable audit trail/);
  });
});
