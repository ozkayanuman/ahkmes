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
  let operationId: string;
  let plantId: string;
  let rawMaterialId: string;
  let tenantId: string;
  let unassignedBinId: string;

  const auth = (r: request.Test) => r.set("Authorization", `Bearer ${adminToken}`);
  const api = () => request(app.getHttpServer());
  /** GET .../oee artık açık plantId/from/to/asOf bağlamı gerektirir (CNC-V1-08R). */
  function oeeContext() {
    const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const to = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const asOf = new Date().toISOString();
    return `plantId=${plantId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&asOf=${encodeURIComponent(asOf)}`;
  }

  /** BOM+Recipe+ProductionDefinition'ı yayınlayıp iş emrini release-engineering
   * ile geçirir, ardından tek operasyon için koşu başlatır. */
  async function releasedRun(pId: string, quantity: number, idealCycleTimeSec?: number) {
    const revision = `REL-${Math.random().toString(36).slice(2)}`;
    const bom = await auth(api().post("/boms").send({
      partId: pId, revision,
      lines: [{ itemType: "MATERIAL", itemId: rawMaterialId, qtyPer: 1, unit: "KG" }],
    }));
    const recipe = await auth(api().post("/recipes").send({ partId: pId, revision, steps: [{ seq: 1, name: "OEE operasyonu", ...(idealCycleTimeSec ? { idealCycleTimeSec } : {}) }] }));
    await auth(api().patch(`/parts/${pId}/engineering-status`).send({ status: "RELEASED" })).expect(200);
    await auth(api().patch(`/boms/${bom.body.id}/status`).send({ status: "RELEASED" })).expect(200);
    await auth(api().patch(`/recipes/${recipe.body.id}/status`).send({ status: "RELEASED" })).expect(200);
    const definition = await auth(api().post("/production-definitions").send({
      plantId, partId: pId, bomHeaderId: bom.body.id, recipeHeaderId: recipe.body.id,
    }));
    await auth(api().patch(`/production-definitions/${definition.body.id}/status`).send({ status: "RELEASED" })).expect(200);
    const created = await auth(api().post("/work-orders").send({
      partId: pId, quantity, dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    }));
    const released = await auth(api().post(`/work-orders/${created.body.id}/release-engineering`).send({
      plantId, productionDefinitionId: definition.body.id,
    })).expect(201);
    // Kanonik OEE motoru (CNC-V1-08R) yalnızca plannedStartDate/plannedEndDate
    // atanmış iş emirlerini kapsama alıyor.
    await auth(api().patch(`/work-orders/${released.body.id}/schedule`).send({
      plannedStartDate: new Date(Date.now() - 3600_000).toISOString(),
      plannedEndDate: new Date(Date.now() + 3600_000).toISOString(),
    })).expect(200);
    const operationId = released.body.operations[0].id as string;
    // HMI start() malzeme tahsisinin (MANUAL_ISSUE) tam karşılanmasını ister.
    const requirements = await auth(api().get(`/production-material/work-orders/${released.body.id}`)).expect(200);
    const requirement = requirements.body[0];
    const reservation = await auth(api().post("/production-material/reservations").send({
      requirementId: requirement.id, binId: unassignedBinId, quantity: requirement.requiredQty, idempotencyKey: `oee-reserve-${released.body.id}`,
    })).expect(201);
    await auth(api().post("/production-material/issue").send({
      requirementId: requirement.id, reservationId: reservation.body.id, quantity: requirement.requiredQty, idempotencyKey: `oee-issue-${released.body.id}`,
    })).expect(201);
    // Kanonik OEE motoru yalnızca ProductionReport'tan (canonical
    // report/complete akışı) okuyor; legacy PATCH /runs/:id bu tabloya
    // yazmıyor. HMI start/report gerçek raporu üretir.
    await auth(api().post(`/hmi/operations/${operationId}/start`).send({})).expect(201);
    // Test aynı milisaniye içinde start→report yapıyor; gerçekçi bir RUNNING
    // süresi (Performance = ideal/actual) için START olayını geriye alıyoruz.
    await prisma.productionExecutionEvent.updateMany({ where: { tenantId, operationId, type: "START" }, data: { createdAt: new Date(Date.now() - 120_000) } });
    return { workOrderId: released.body.id as string, operationId };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const login = await api()
      .post("/auth/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    adminToken = login.body.accessToken;

    const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    tenantId = admin.tenantId;
    for (const action of ["HMI_START", "HMI_REPORT"]) {
      const exists = await prisma.actionPermissionGrant.findFirst({ where: { tenantId: admin.tenantId, action, role: "ADMIN" } });
      if (!exists) await prisma.actionPermissionGrant.create({ data: { tenantId: admin.tenantId, action, role: "ADMIN", createdById: admin.id } });
    }

    plantId = (await auth(api().post("/hierarchy/plants").send({ name: `OEE Plant ${STAMP}` }))).body.id;
    rawMaterialId = (await auth(api().post("/materials").send({ code: `OEE-RAW-${STAMP}`, name: "OEE Hammadde", type: "RAW", unit: "KG" }))).body.id;
    // HMI start()'ın malzeme tahsis kapısını geçmek için hammaddeyi
    // varsayılan (UNASSIGNED) rafa stoklu hale getir.
    const supplierId = (await auth(api().post("/suppliers").send({ name: `OEE Supplier ${STAMP}` }))).body.id;
    const po = await auth(api().post("/purchase-orders").send({
      supplierId, orderDate: new Date().toISOString(),
      lines: [{ materialId: rawMaterialId, quantity: 1000, unitPrice: 1 }],
    }));
    await auth(api().post(`/purchase-orders/${po.body.id}/receive`).send({ lines: [{ lineId: po.body.lines[0].id, receivedQty: 1000 }] })).expect(201);
    unassignedBinId = (await prisma.bin.findFirstOrThrow({ where: { tenantId, code: "UNASSIGNED" } })).id;
    // Availability, planlanan üretim zamanını vardiya takviminden türetiyor;
    // takvim yoksa "MISSING_PLANNED_PRODUCTION_TIME" ile null kalır.
    const calendar = await prisma.plantProductionCalendar.create({
      data: { tenantId, plantId, name: `OEE Calendar ${STAMP}`, timezone: "UTC", weeklyWorkingDays: [1, 2, 3, 4, 5, 6, 7] },
    });
    await prisma.productionShift.create({ data: { tenantId, plantId, calendarId: calendar.id, code: "ALL", name: "All day", startMinute: 0, endMinute: 1439 } });

    partId = (
      await auth(
        api()
          .post("/parts")
          .send({ partNo: `OEE-${STAMP}`, revision: "A", name: "OEE Testi", idealCycleTimeSec: 10 }),
      )
    ).body.id;
    const run = await releasedRun(partId, 100, 10);
    workOrderId = run.workOrderId;
    operationId = run.operationId;
  });

  afterAll(async () => {
    await prisma.productionRun.deleteMany({ where: { workOrderId } });
    await prisma.workOrderCostBaseline.deleteMany({ where: { workOrderId } });
    await prisma.workOrder.deleteMany({ where: { id: workOrderId } });
    await prisma.productionDefinition.deleteMany({ where: { partId } });
    await prisma.bomHeader.deleteMany({ where: { partId } });
    await prisma.recipeHeader.deleteMany({ where: { partId } });
    await prisma.part.deleteMany({ where: { id: partId } });
    await app.close();
  });

  it("idealCycleTimeSec yokken performance/oee null döner, quality hesaplanır", async () => {
    const partNoIdeal = (
      await auth(api().post("/parts").send({ partNo: `OEE-NOIDEAL-${STAMP}`, revision: "A", name: "İdealsiz" }))
    ).body.id;
    const { workOrderId: woNoIdeal, operationId: opNoIdeal } = await releasedRun(partNoIdeal, 10);
    // Kanonik motor idealProductionTimeSeconds'ı yalnızca en az bir
    // ProductionReport'tan türetiyor; hiç rapor yoksa 0 (null değil) kalır.
    await auth(api().post(`/hmi/operations/${opNoIdeal}/reports`).send({ goodQty: 1, scrapQty: 0, idempotencyKey: `oee-noideal-${STAMP}` })).expect(201);

    const res = await auth(api().get(`/work-orders/${woNoIdeal}/oee?${oeeContext()}`)).expect(200);
    // Availability yalnızca planlanan/gerçekleşen zamana bağlıdır, ideal
    // çevrim süresine değil — bu kapsamda gerçek (null olmayan) bir değer
    // döner. idealCycleTimeSec yokluğunun etkilediği tek şey performance/oee'dir.
    expect(res.body.performance).toBeNull();
    expect(res.body.oee).toBeNull();

    await prisma.productionRun.deleteMany({ where: { workOrderId: woNoIdeal } });
    await prisma.workOrderCostBaseline.deleteMany({ where: { workOrderId: woNoIdeal } });
    await prisma.workOrder.deleteMany({ where: { id: woNoIdeal } });
    await prisma.productionDefinition.deleteMany({ where: { partId: partNoIdeal } });
    await prisma.bomHeader.deleteMany({ where: { partId: partNoIdeal } });
    await prisma.recipeHeader.deleteMany({ where: { partId: partNoIdeal } });
    await prisma.part.deleteMany({ where: { id: partNoIdeal } });
  });

  it("goodCount/scrapCount girilince quality doğru hesaplanır", async () => {
    await auth(api().post(`/hmi/operations/${operationId}/reports`).send({ goodQty: 8, scrapQty: 2, idempotencyKey: `oee-main-${STAMP}` })).expect(201);
    const res = await auth(api().get(`/work-orders/${workOrderId}/oee?${oeeContext()}`)).expect(200);
    expect(res.body.quality).toBeCloseTo(0.8, 2);
    expect(res.body.goodCount).toBe(8);
    expect(res.body.scrapCount).toBe(2);
  });

  it("idealCycleTimeSec varken performance ve oee hesaplanır (0-1 arası)", async () => {
    const res = await auth(api().get(`/work-orders/${workOrderId}/oee?${oeeContext()}`)).expect(200);
    expect(res.body.performance).not.toBeNull();
    expect(res.body.performance).toBeGreaterThanOrEqual(0);
    expect(res.body.performance).toBeLessThanOrEqual(1);
    expect(res.body.availability).not.toBeNull();
    expect(res.body.oee).toBeCloseTo(res.body.availability * res.body.quality * res.body.performance, 5);
  });

  it("olmayan iş emri için 404 döner", async () => {
    await auth(api().get(`/work-orders/00000000-0000-0000-0000-000000000099/oee?${oeeContext()}`)).expect(404);
  });
});
