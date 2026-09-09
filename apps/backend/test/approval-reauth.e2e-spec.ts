import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import * as bcrypt from "bcryptjs";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();

/**
 * AHK-006 — CAPA ve MRP proposal kararlarının (ApprovalsService.approve/reject
 * üzerinden geçen tüm kritik kararlar) artık yeniden kimlik doğrulama (reauth)
 * gerektirdiğini kanıtlar: yanlış şifre 401, doğru şifre başarı + audit'te kanıt.
 */
describe("AHK-006 onay kararlarında reauth (PostgreSQL e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken = "";
  let tenantId = "";
  let requesterId = "";

  const api = () => request(app.getHttpServer());
  const as = (token: string, call: request.Test) => call.set("Authorization", `Bearer ${token}`);

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    adminToken = (await api().post("/auth/login").send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }).expect(201)).body.accessToken;
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    tenantId = admin.tenantId;

    // Talebi oluşturan, karar veren admin'den farklı biri olmalı (requester≠approver kuralı).
    const requester = await prisma.user.create({
      data: { tenantId, email: `reauth-requester-${STAMP}@ahkmes.local`, passwordHash: await bcrypt.hash("Requester1!", 10), name: "Reauth requester", role: "PLANNER" },
    });
    requesterId = requester.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("CAPA onayı: yanlış şifre 401 döner, hiçbir şey değişmez", async () => {
    const capa = await prisma.capa.create({ data: { tenantId, dofNo: `CAPA-REAUTH-${STAMP}`, title: "Reauth test", status: "PENDING_APPROVAL", createdById: requesterId } });
    await prisma.approvalRequest.create({ data: { tenantId, entity: "capa", entityId: capa.id, requestedById: requesterId, requiredRoles: ["ADMIN"], status: "PENDING" } });

    await as(adminToken, api().patch(`/capa/${capa.id}/approve`).send({ password: "yanlisSifre!" })).expect(401);
    const stillPending = await prisma.capa.findUniqueOrThrow({ where: { id: capa.id } });
    expect(stillPending.status).toBe("PENDING_APPROVAL");
  });

  it("CAPA onayı: doğru şifreyle onaylanır ve audit'e reauth kanıtı yazılır", async () => {
    const capa = await prisma.capa.create({ data: { tenantId, dofNo: `CAPA-REAUTH-OK-${STAMP}`, title: "Reauth test ok", status: "PENDING_APPROVAL", createdById: requesterId } });
    const approvalReq = await prisma.approvalRequest.create({ data: { tenantId, entity: "capa", entityId: capa.id, requestedById: requesterId, requiredRoles: ["ADMIN"], status: "PENDING" } });

    const res = await as(adminToken, api().patch(`/capa/${capa.id}/approve`).send({ password: ADMIN_PASSWORD, note: "onaylandı" })).expect(200);
    expect(res.body.status).toBe("APPROVED");

    const auditRow = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId, entity: "approval-requests", entityId: approvalReq.id, action: "STATUS_CHANGE" },
      orderBy: { createdAt: "desc" },
    });
    const after = auditRow.after as Record<string, unknown>;
    expect(after.reauthSource).toBe("LOCAL");
    expect(after.reauthenticatedAt).toBeTruthy();
  });

  it("CAPA onayı: şifre eksikse 400 (Zod) döner", async () => {
    const capa = await prisma.capa.create({ data: { tenantId, dofNo: `CAPA-REAUTH-NOPW-${STAMP}`, title: "Reauth test no password", status: "PENDING_APPROVAL", createdById: requesterId } });
    await prisma.approvalRequest.create({ data: { tenantId, entity: "capa", entityId: capa.id, requestedById: requesterId, requiredRoles: ["ADMIN"], status: "PENDING" } });

    await as(adminToken, api().patch(`/capa/${capa.id}/approve`).send({})).expect(400);
  });

  it("MRP satın alma önerisi reddi: yanlış şifre 401 döner, doğru şifreyle reddedilir", async () => {
    const proposal = await prisma.purchaseProposal.create({ data: { tenantId, ppNo: `PPR-REAUTH-${STAMP}`, status: "PENDING_APPROVAL" } });
    await prisma.approvalRequest.create({ data: { tenantId, entity: "purchase-proposal", entityId: proposal.id, requestedById: requesterId, requiredRoles: ["PLANNER"], status: "PENDING" } });

    await as(adminToken, api().patch(`/mrp/purchase-proposals/${proposal.id}/reject`).send({ password: "yanlisSifre!" })).expect(401);
    const stillPending = await prisma.purchaseProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(stillPending.status).toBe("PENDING_APPROVAL");

    const res = await as(adminToken, api().patch(`/mrp/purchase-proposals/${proposal.id}/reject`).send({ password: ADMIN_PASSWORD, note: "gerekli değil" })).expect(200);
    expect(res.body.status).toBe("REJECTED");
  });
});
