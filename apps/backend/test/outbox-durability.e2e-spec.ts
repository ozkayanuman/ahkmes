import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import * as bcrypt from "bcryptjs";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { OutboxDispatcherService } from "../src/outbox/outbox-dispatcher.service";
import { RealtimeGateway } from "../src/realtime/realtime.gateway";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();

/**
 * AHK-009 — CAPA onay kararının OutboxEvent'i domain transaction'ıyla AYNI
 * anda commit olduğunu ve dispatcher çalışmasa dahi kaybolmadığını kanıtlar:
 * dispatcher'ın arka plan zamanlayıcısı durdurulur, CAPA onaylanır, event
 * PENDING kalır (kaybolmaz), sonra dispatcher manuel tetiklenince DISPATCHED
 * olur ve RealtimeGateway.emitToTenant tam olarak bir kez çağrılır.
 */
describe("AHK-009 outbox dayanıklılığı (PostgreSQL e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let dispatcher: OutboxDispatcherService;
  let realtime: RealtimeGateway;
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
    dispatcher = app.get(OutboxDispatcherService);
    realtime = app.get(RealtimeGateway);
    // Dispatcher'ın 5sn'lik arka plan zamanlayıcısını durdur — testin geri
    // kalanı OutboxEvent'in gerçekten "dispatcher çalışmıyor" koşulunda
    // PENDING kaldığını, sadece manuel processPending() sonrası DISPATCHED
    // olduğunu doğrulayabilsin.
    dispatcher.onModuleDestroy();

    adminToken = (await api().post("/auth/login").send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }).expect(201)).body.accessToken;
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    tenantId = admin.tenantId;

    const requester = await prisma.user.create({
      data: { tenantId, email: `outbox-requester-${STAMP}@ahkmes.local`, passwordHash: await bcrypt.hash("Requester1!", 10), name: "Outbox requester", role: "PLANNER" },
    });
    requesterId = requester.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("CAPA onaylanınca OutboxEvent aynı transaction'da PENDING olarak yazılır; dispatcher durdurulmuşken kaybolmaz", async () => {
    const capa = await prisma.capa.create({
      data: { tenantId, dofNo: `CAPA-OUTBOX-${STAMP}`, title: "Outbox durability test", status: "PENDING_APPROVAL", createdById: requesterId },
    });
    await prisma.approvalRequest.create({
      data: { tenantId, entity: "capa", entityId: capa.id, requestedById: requesterId, requiredRoles: ["ADMIN"], status: "PENDING" },
    });

    const emitSpy = jest.spyOn(realtime, "emitToTenant");

    const res = await as(adminToken, api().patch(`/capa/${capa.id}/approve`).send({ password: ADMIN_PASSWORD, note: "outbox test" })).expect(200);
    expect(res.body.status).toBe("APPROVED");

    const pending = await prisma.outboxEvent.findFirstOrThrow({
      where: { tenantId, aggregateType: "capa", aggregateId: capa.id, eventType: "capa.updated" },
    });
    expect(pending.status).toBe("PENDING");
    expect(pending.payload).toMatchObject({ id: capa.id, status: "APPROVED" });
    // Dispatcher durduruldu — CAPA onaylandıktan sonra bile "capa.updated"
    // emitToTenant ÇAĞRILMAMIŞ olmalı (eski davranışta burası fire-and-forget'ti).
    // ("notification.created" gibi başka, outbox'a taşınmamış çağrılar bu
    // testin kapsamı dışıdır — approvals.notifyDecision hâlâ transaction dışı.)
    const capaUpdatedCalls = () => emitSpy.mock.calls.filter(([, event]) => event === "capa.updated");
    expect(capaUpdatedCalls()).toHaveLength(0);

    // Dispatcher'ı (yeniden başlamış gibi) manuel tetikle.
    await dispatcher.processPending();

    const dispatched = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: pending.id } });
    expect(dispatched.status).toBe("DISPATCHED");
    expect(dispatched.dispatchedAt).toBeTruthy();
    expect(capaUpdatedCalls()).toHaveLength(1);
    expect(capaUpdatedCalls()[0]).toEqual([tenantId, "capa.updated", { id: capa.id, status: "APPROVED" }]);

    emitSpy.mockRestore();
  });
});
