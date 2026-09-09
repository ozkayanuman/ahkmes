import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();

/**
 * AHK-012 (daraltılmış dilim) — DEVIATION actionType'lı bir NCR, CAPA'nın
 * ApprovalsService/reauth desenini kullanan formal bir onay olmadan
 * kapatılamaz.
 */
describe("Non-Conformance — deviation onay akışı (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let secondAdminToken: string;
  let partId: string;
  let workOrderId: string;
  let ncId: string;
  let secondAdminId: string;

  const auth = (r: request.Test) => r.set("Authorization", `Bearer ${adminToken}`);
  const asSecondAdmin = (r: request.Test) => r.set("Authorization", `Bearer ${secondAdminToken}`);
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    adminToken = (await api().post("/auth/login").send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }).expect(201)).body.accessToken;
    const tenantId = (await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } })).tenantId;

    const secondAdmin = await prisma.user.create({
      data: { tenantId, email: `dev-admin2-${STAMP}@ahkmes.local`, passwordHash: await bcrypt.hash("SecondAdmin1!", 10), name: "İkinci Admin", role: "ADMIN" },
    });
    secondAdminId = secondAdmin.id;
    secondAdminToken = (await api().post("/auth/login").send({ email: secondAdmin.email, password: "SecondAdmin1!" }).expect(201)).body.accessToken;

    partId = (await auth(api().post("/parts").send({ partNo: `NCDEV-${STAMP}`, revision: "A", name: "Deviation Testi" }))).body.id;
    workOrderId = (
      await auth(api().post("/work-orders").send({ partId, quantity: 10, dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString() }))
    ).body.id;

    const nc = await auth(
      api().post("/non-conformances").send({ workOrderId, failureType: "Tolerans dışı çap", actionType: "DEVIATION" }),
    ).expect(201);
    ncId = nc.body.id;
  });

  afterAll(async () => {
    await prisma.approvalRequest.deleteMany({ where: { entity: "non-conformance", entityId: ncId } }).catch(() => undefined);
    await prisma.nonConformance.deleteMany({ where: { workOrderId } }).catch(() => undefined);
    await prisma.workOrder.deleteMany({ where: { id: workOrderId } }).catch(() => undefined);
    await prisma.part.deleteMany({ where: { id: partId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: secondAdminId } }).catch(() => undefined);
    await app.close();
  });

  it("onay talep edilmeden kapatılamaz", async () => {
    await auth(api().patch(`/non-conformances/${ncId}/resolve`).send({ status: "RESOLVED", resolutionNote: "kabul edildi" })).expect(409);
  });

  it("onay talep edilir, NCR PENDING_DEVIATION_APPROVAL'a geçer", async () => {
    const res = await auth(api().patch(`/non-conformances/${ncId}/request-deviation`).send({})).expect(200);
    expect(res.body.status).toBe("PENDING_DEVIATION_APPROVAL");
  });

  it("yanlış şifreyle onay 401 döner", async () => {
    await asSecondAdmin(api().patch(`/non-conformances/${ncId}/approve-deviation`).send({ password: "YanlisSifre1!" })).expect(401);
  });

  it("talebi oluşturan kendi talebini onaylayamaz (SoD)", async () => {
    await auth(api().patch(`/non-conformances/${ncId}/approve-deviation`).send({ password: ADMIN_PASSWORD })).expect(403);
  });

  it("doğru şifreyle onaylanınca NCR OPEN'a döner ve artık kapatılabilir", async () => {
    const decided = await asSecondAdmin(
      api().patch(`/non-conformances/${ncId}/approve-deviation`).send({ password: "SecondAdmin1!", note: "kalite mühendisi kabul etti" }),
    ).expect(200);
    expect(decided.body.status).toBe("OPEN");

    const resolved = await auth(
      api().patch(`/non-conformances/${ncId}/resolve`).send({ status: "RESOLVED", resolutionNote: "deviation onayıyla kabul edildi" }),
    ).expect(200);
    expect(resolved.body.status).toBe("RESOLVED");
  });
});
