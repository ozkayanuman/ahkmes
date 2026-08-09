import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();

describe("AHK-014 — tenant module entitlements (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantA: string;
  let adminToken: string;
  let tenantB: string;
  let tenantBToken: string;
  let operatorToken: string;

  const api = () => request(app.getHttpServer());
  const auth = (token: string, r: request.Test) => r.set("Authorization", `Bearer ${token}`);
  const login = async (email: string, password: string) => (await api().post("/auth/login").send({ email, password }).expect(201)).body.accessToken as string;
  const auditCount = () => prisma.auditLog.count({ where: { tenantId: tenantA, entity: "tenant-module-entitlements" } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    tenantA = (await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } })).tenantId;

    const passwordHash = await bcrypt.hash("TenantTest123!", 10);
    tenantB = `tenant-entitlement-${STAMP}`;
    await prisma.tenant.create({ data: { id: tenantB, name: `Entitlement tenant ${STAMP}` } });
    await prisma.user.create({
      data: { tenantId: tenantB, email: `tenant-admin-${STAMP}@ahkmes.test`, passwordHash, name: "Tenant B Admin", role: "ADMIN" },
    });
    await prisma.user.create({
      data: { tenantId: tenantA, email: `tenant-operator-${STAMP}@ahkmes.test`, passwordHash, name: "Tenant A Operator", role: "OPERATOR" },
    });
    tenantBToken = await login(`tenant-admin-${STAMP}@ahkmes.test`, "TenantTest123!");
    operatorToken = await login(`tenant-operator-${STAMP}@ahkmes.test`, "TenantTest123!");
  });

  afterAll(async () => {
    // Bu dosyadaki son testler QMS_INSPECTION'ı isEnabled:false bırakıyor — paylaşılan
    // varsayılan tenant'ı (tenantA) kirletir, tam suite çalıştığında "alarms" sayfasını
    // (QMS_INSPECTION'a eşlenir, bkz. packages/shared-types/src/enums.ts PAGE_PRODUCT_MODULE)
    // yeniden kullanan downtime.e2e-spec.ts gibi sonraki dosyalarda sahte 403'e yol açar.
    await auth(adminToken, api().patch("/platform/modules/QMS_INSPECTION").send({ isEnabled: true }));
    await app.close();
  });

  it("defaults unconfigured modules to enabled and denies an unauthenticated caller", async () => {
    await api().get("/platform/modules").expect(401);
    const modules = await auth(adminToken, api().get("/platform/modules")).expect(200);
    expect(modules.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ module: "QMS_INSPECTION", isEnabled: true, configured: false }),
    ]));
    const catalog = await auth(adminToken, api().get("/platform/modules/catalog")).expect(200);
    expect(catalog.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "MES_DNC", implementationStatus: "MISSING", tenantToggleable: false }),
    ]));
  });

  it("accepts only an admin PATCH and never accepts tenantId from the request body", async () => {
    await auth(operatorToken, api().patch("/platform/modules/QMS_INSPECTION").send({ isEnabled: false })).expect(403);
    await auth(adminToken, api().patch("/platform/modules/NOT_A_MODULE").send({ isEnabled: false })).expect(400);

    await auth(adminToken, api().patch("/platform/modules/QMS_INSPECTION").send({ isEnabled: false, tenantId: tenantB })).expect(200);
    await auth(adminToken, api().patch("/platform/modules/PLATFORM_CORE").send({ isEnabled: false })).expect(400);
    await auth(adminToken, api().patch("/platform/modules/NOT_A_MODULE").send({ isEnabled: true })).expect(400);
    const tenantBModules = await auth(tenantBToken, api().get("/platform/modules")).expect(200);
    expect(tenantBModules.body.find((item: { module: string }) => item.module === "QMS_INSPECTION")).toMatchObject({ isEnabled: true, configured: false });
    expect(tenantBModules.body.find((item: { module: string }) => item.module === "QMS_NCR_CAPA")).toMatchObject({ isEnabled: true, configured: false });
  });

  it("blocks the disabled module on the protected backend endpoint, then restores access", async () => {
    await auth(adminToken, api().get("/inspections")).expect(403);
    // The admin recovery API intentionally remains available while Platform Core is disabled.
    await auth(adminToken, api().get("/platform/modules")).expect(200);
    await auth(adminToken, api().patch("/platform/modules/QMS_INSPECTION").send({ isEnabled: true })).expect(200);
    await auth(adminToken, api().get("/inspections")).expect(200);
  });

  it("is idempotent and records exactly one audit for concurrent same-state requests", async () => {
    const before = await auditCount();
    await auth(adminToken, api().patch("/platform/modules/QMS_INSPECTION").send({ isEnabled: false })).expect(200);
    await auth(adminToken, api().patch("/platform/modules/QMS_INSPECTION").send({ isEnabled: false })).expect(200);
    expect(await auditCount()).toBe(before + 1);

    await auth(adminToken, api().patch("/platform/modules/QMS_INSPECTION").send({ isEnabled: true })).expect(200);
    const beforeConcurrent = await auditCount();
    const results = await Promise.all([
      auth(adminToken, api().patch("/platform/modules/QMS_INSPECTION").send({ isEnabled: false })),
      auth(adminToken, api().patch("/platform/modules/QMS_INSPECTION").send({ isEnabled: false })),
    ]);
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    expect(await auditCount()).toBe(beforeConcurrent + 1);

    const audit = await prisma.auditLog.findFirst({
      where: { tenantId: tenantA, entity: "tenant-module-entitlements" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.after).toEqual(expect.objectContaining({ module: "QMS_INSPECTION", isEnabled: false }));
  });

  it("edition: FOUNDATION tenant ENTERPRISE-seviye bir modülü açamaz/kullanamaz, yükseltilince açabilir, düşürülünce zaten açık modül de bloklanır", async () => {
    // tenantB izole bir tenant (bu dosyanın kendi kurduğu, başka e2e dosyasıyla paylaşılmıyor) —
    // burada edition değiştirmek diğer dosyaları etkilemez, tenantA'ya (paylaşılan varsayılan) dokunulmuyor.
    await auth(tenantBToken, api().patch("/platform/modules/edition").send({ edition: "FOUNDATION" })).expect(200);
    expect((await auth(tenantBToken, api().get("/platform/modules/edition")).expect(200)).body).toEqual({ edition: "FOUNDATION" });

    await auth(tenantBToken, api().patch("/platform/modules/PLATFORM_AI").send({ isEnabled: true })).expect(400);

    await auth(tenantBToken, api().patch("/platform/modules/edition").send({ edition: "ENTERPRISE" })).expect(200);
    await auth(tenantBToken, api().patch("/platform/modules/PLATFORM_AI").send({ isEnabled: true })).expect(200);
    await auth(tenantBToken, api().post("/copilot/drafts").send({ prompt: "edition test prompt" })).expect(201);

    await auth(tenantBToken, api().patch("/platform/modules/edition").send({ edition: "FOUNDATION" })).expect(200);
    await auth(tenantBToken, api().post("/copilot/drafts").send({ prompt: "edition test prompt" })).expect(403);

    await auth(tenantBToken, api().patch("/platform/modules/edition").send({ edition: "ENTERPRISE" })).expect(200);
  });

  it("non-admin PATCH /platform/modules/edition çağıramaz", async () => {
    await auth(operatorToken, api().patch("/platform/modules/edition").send({ edition: "FOUNDATION" })).expect(403);
    await auth(adminToken, api().patch("/platform/modules/edition").send({ edition: "NOT_AN_EDITION" })).expect(400);
  });

  it("never reads or mutates Material and WorkOrder records across the tenant boundary", async () => {
    const material = await prisma.material.create({
      data: { tenantId: tenantA, code: `ISO-MAT-${STAMP}`, name: "Isolation material", type: "RAW", unit: "KG" },
    });
    const part = await prisma.part.create({
      data: { tenantId: tenantA, partNo: `ISO-PART-${STAMP}`, name: "Isolation part" },
    });
    const workOrder = await prisma.workOrder.create({
      data: { tenantId: tenantA, woNo: `ISO-WO-${STAMP}`, partId: part.id, quantity: 1, dueDate: new Date() },
    });

    await auth(tenantBToken, api().get(`/materials/${material.id}`)).expect(404);
    await auth(tenantBToken, api().patch(`/materials/${material.id}`).send({ name: "Cross tenant edit" })).expect(404);
    await auth(tenantBToken, api().delete(`/materials/${material.id}`)).expect(404);
    await auth(tenantBToken, api().get(`/work-orders/${workOrder.id}`)).expect(404);
    await auth(tenantBToken, api().patch(`/work-orders/${workOrder.id}/status`).send({ status: "CANCELLED" })).expect(404);

    expect((await prisma.material.findUniqueOrThrow({ where: { id: material.id } })).name).toBe("Isolation material");
    expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: workOrder.id } })).status).toBe("PLANNED");
  });
});
