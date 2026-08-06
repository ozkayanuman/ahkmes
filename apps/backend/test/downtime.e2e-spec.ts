import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();

/**
 * Downtime/Andon taksonomisi — MachineStatusEvent(ALARM)'ın serbest metin
 * downtimeNote'undan bağımsız, açık/kapalı yaşam döngüsü olan yapılandırılmış
 * DowntimeEvent kaydını kanıtlar: ALARM telemetrisi otomatik açar
 * (sınıflandırılmamış), sonraki CYCLE_START otomatik kapatır; ayrıca elle
 * Andon çağrısı (POST /downtime/start) + classify + end akışı.
 */
describe("Downtime/Andon taksonomisi (PostgreSQL e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let partId: string;
  let machineId: string;
  let workOrderId: string;
  let machineKey: string;
  let reasonId: string;

  const auth = (r: request.Test) => r.set("Authorization", `Bearer ${adminToken}`);
  const api = () => request(app.getHttpServer());
  const withKey = (r: request.Test) => r.set("X-Machine-Key", machineKey);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    adminToken = (await api().post("/auth/login").send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).body.accessToken;

    partId = (await auth(api().post("/parts").send({ partNo: `DT-${STAMP}`, revision: "A", name: "Downtime Testi" }))).body.id;
    machineId = (await auth(api().post("/machines").send({ name: `Downtime Tezgah ${STAMP}`, model: "Test" }))).body.id;
    workOrderId = (
      await auth(
        api().post("/work-orders").send({
          partId,
          quantity: 10,
          dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
          machineId,
        }),
      )
    ).body.id;
    const keyRes = await auth(api().post(`/machines/${machineId}/connector-key`)).expect(201);
    machineKey = keyRes.body.key;

    reasonId = (
      await auth(
        api().post("/downtime/reasons").send({ code: `MECH-${STAMP}`, label: "Mekanik arıza", category: "UNPLANNED" }),
      )
    ).body.id;

    await auth(api().patch(`/machines/${machineId}/active-work-order`).send({ workOrderId })).expect(200);
  });

  afterAll(async () => {
    await prisma.downtimeEvent.deleteMany({ where: { machineId } }).catch(() => undefined);
    await prisma.downtimeReason.deleteMany({ where: { id: reasonId } }).catch(() => undefined);
    await prisma.productionRun.deleteMany({ where: { workOrderId } }).catch(() => undefined);
    await prisma.workOrder.deleteMany({ where: { id: workOrderId } }).catch(() => undefined);
    await prisma.machine.deleteMany({ where: { id: machineId } }).catch(() => undefined);
    await prisma.part.deleteMany({ where: { id: partId } }).catch(() => undefined);
    await app.close();
  });

  it("ALARM telemetrisi sınıflandırılmamış (reasonId=null) bir DowntimeEvent açar; ikinci ALARM ikinci kayıt açmaz (idempotent)", async () => {
    await withKey(api().post(`/machines/${machineId}/telemetry`).send({ type: "ALARM", payload: { message: "Spindle aşırı yük" } })).expect(201);

    const open = await prisma.downtimeEvent.findFirstOrThrow({ where: { machineId, endedAt: null } });
    expect(open.source).toBe("ALARM");
    expect(open.reasonId).toBeNull();
    expect(open.endedAt).toBeNull();

    await withKey(api().post(`/machines/${machineId}/telemetry`).send({ type: "ALARM", payload: { message: "Spindle aşırı yük" } })).expect(201);
    const stillOpenCount = await prisma.downtimeEvent.count({ where: { machineId, endedAt: null } });
    expect(stillOpenCount).toBe(1);

    const list = await auth(api().get(`/downtime?machineId=${machineId}&open=true`)).expect(200);
    expect(list.body).toHaveLength(1);
  });

  it("supervisor açık kaydı sınıflandırabilir (classify)", async () => {
    const open = await prisma.downtimeEvent.findFirstOrThrow({ where: { machineId, endedAt: null } });

    const res = await auth(api().patch(`/downtime/${open.id}/classify`).send({ reasonId })).expect(200);
    expect(res.body.reasonId).toBe(reasonId);
  });

  it("CYCLE_START (üretime dönüş) açık kaydı otomatik kapatır", async () => {
    const beforeOpen = await prisma.downtimeEvent.findFirstOrThrow({ where: { machineId, endedAt: null } });

    await withKey(api().post(`/machines/${machineId}/telemetry`).send({ type: "CYCLE_START" })).expect(201);

    const closed = await prisma.downtimeEvent.findUniqueOrThrow({ where: { id: beforeOpen.id } });
    expect(closed.endedAt).toBeTruthy();
    expect(closed.reasonId).toBe(reasonId); // classify() ile önceden atanan neden korunur

    const openCount = await prisma.downtimeEvent.count({ where: { machineId, endedAt: null } });
    expect(openCount).toBe(0);
  });

  it("elle Andon çağrısı: start → aynı makinede ikinci manuel start 409 döner → end ile kapatılır", async () => {
    const started = await auth(api().post("/downtime/start").send({ machineId, reasonId, note: "Malzeme bekleniyor" })).expect(201);
    expect(started.body.source).toBe("MANUAL");
    expect(started.body.endedAt).toBeNull();

    await auth(api().post("/downtime/start").send({ machineId })).expect(409);

    const ended = await auth(api().patch(`/downtime/${started.body.id}/end`).send({ note: "Malzeme geldi" })).expect(200);
    expect(ended.body.endedAt).toBeTruthy();

    await auth(api().patch(`/downtime/${started.body.id}/end`).send({})).expect(409);
  });

  it("var olmayan reasonId ile reason'a atıf reddedilir", async () => {
    await auth(
      api().post("/downtime/start").send({ machineId, reasonId: "00000000-0000-0000-0000-000000000099" }),
    ).expect(404);
  });
});
