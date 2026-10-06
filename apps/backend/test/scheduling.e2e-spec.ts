import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();

/**
 * AHK-011 (daraltılmış dilim) — standart süre snapshot'ı ve günlük kapasite
 * yük/aşım görünürlüğü. Gerçek finite scheduling değil: bir iş emrinin
 * standardMinutes toplamı planlanan pencereye eşit dağıtılır.
 */
describe("AHK-011 — standart süre + kapasite yükü (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let partId: string;
  let machineId: string;
  let workOrderId: string;
  let plantId: string;
  let rawMaterialId: string;

  const auth = (r: request.Test) => r.set("Authorization", `Bearer ${adminToken}`);
  const api = () => request(app.getHttpServer());

  /** BOM+Recipe+ProductionDefinition'ı yayınlayıp iş emrini release-engineering
   * ile geçirir — CNC-V1-01'den beri operasyonlar bare create'te dolmaz. */
  async function releasedWorkOrder(pId: string, mId: string, steps: Array<Record<string, unknown>>, quantity = 1) {
    const revision = `REL-${Math.random().toString(36).slice(2)}`;
    const bom = await auth(api().post("/boms").send({
      partId: pId, revision,
      lines: [{ itemType: "MATERIAL", itemId: rawMaterialId, qtyPer: 1, unit: "KG" }],
    })).expect(201);
    const recipe = await auth(api().post("/recipes").send({ partId: pId, revision, steps })).expect(201);
    await auth(api().patch(`/parts/${pId}/engineering-status`).send({ status: "RELEASED" })).expect(200);
    await auth(api().patch(`/boms/${bom.body.id}/status`).send({ status: "RELEASED" })).expect(200);
    await auth(api().patch(`/recipes/${recipe.body.id}/status`).send({ status: "RELEASED" })).expect(200);
    const definition = await auth(api().post("/production-definitions").send({
      plantId, partId: pId, bomHeaderId: bom.body.id, recipeHeaderId: recipe.body.id,
    })).expect(201);
    await auth(api().patch(`/production-definitions/${definition.body.id}/status`).send({ status: "RELEASED" })).expect(200);
    const created = await auth(api().post("/work-orders").send({
      partId: pId, machineId: mId, quantity,
      dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    })).expect(201);
    return auth(api().post(`/work-orders/${created.body.id}/release-engineering`).send({
      plantId, productionDefinitionId: definition.body.id,
    })).expect(201);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    adminToken = (await api().post("/auth/login").send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).body.accessToken;

    plantId = (await auth(api().post("/hierarchy/plants").send({ name: `Kapasite Plant ${STAMP}` }))).body.id;
    rawMaterialId = (await auth(api().post("/materials").send({ code: `SCH-RAW-${STAMP}`, name: "Kapasite Hammadde", type: "RAW", unit: "KG" }))).body.id;
    partId = (await auth(api().post("/parts").send({ partNo: `SCH-${STAMP}`, revision: "A", name: "Kapasite Testi" }))).body.id;
    machineId = (await auth(api().post("/machines").send({ name: `Kapasite Tezgah ${STAMP}`, model: "Test" }))).body.id;
    await auth(api().patch(`/machines/${machineId}`).send({ dailyCapacityMinutes: 480 })).expect(200);

    const wo = await releasedWorkOrder(partId, machineId, [{ seq: 1, name: "Tornalama", standardMinutes: 100 }]);
    workOrderId = wo.body.id;
  });

  afterAll(async () => {
    await prisma.workOrderOperation.deleteMany({ where: { workOrderId } }).catch(() => undefined);
    await prisma.workOrderCostBaseline.deleteMany({ where: { workOrderId } }).catch(() => undefined);
    await prisma.workOrder.deleteMany({ where: { id: workOrderId } }).catch(() => undefined);
    await prisma.productionDefinition.deleteMany({ where: { partId } }).catch(() => undefined);
    await prisma.bomHeader.deleteMany({ where: { partId } }).catch(() => undefined);
    await prisma.recipeHeader.deleteMany({ where: { partId } }).catch(() => undefined);
    await prisma.machine.deleteMany({ where: { id: machineId } }).catch(() => undefined);
    await prisma.part.deleteMany({ where: { id: partId } }).catch(() => undefined);
    await prisma.material.deleteMany({ where: { id: rawMaterialId } }).catch(() => undefined);
    await prisma.plant.deleteMany({ where: { id: plantId } }).catch(() => undefined);
    await app.close();
  });

  it("recipe'nin standardMinutes'i WorkOrderOperation'a immutable snapshot olarak kopyalanır", async () => {
    const operations = await auth(api().get(`/work-orders/${workOrderId}/operations`)).expect(200);
    expect(operations.body).toHaveLength(1);
    expect(Number(operations.body[0].standardMinutes)).toBe(100);
  });

  it("kapasite endpoint'i planlanan pencereye eşit dağıtılmış yükü döner, aşımı işaretler", async () => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);

    await auth(
      api().patch(`/work-orders/${workOrderId}/schedule`).send({
        plannedStartDate: from.toISOString(),
        plannedEndDate: to.toISOString(),
      }),
    ).expect(200);

    const capacity = await auth(
      api().get(`/scheduling/capacity?from=${from.toISOString()}&to=${to.toISOString()}`),
    ).expect(200);

    const rows = capacity.body.filter((r: { machineId: string }) => r.machineId === machineId);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.loadMinutes).toBe(50);
      expect(row.capacityMinutes).toBe(480);
      expect(row.overloaded).toBe(false);
    }
  });

  it("dailyCapacityMinutes'i aşan bir yük overloaded:true döner", async () => {
    const bigMachine = (await auth(api().post("/machines").send({ name: `Aşım Tezgah ${STAMP}`, model: "Test" }))).body.id;
    await auth(api().patch(`/machines/${bigMachine}`).send({ dailyCapacityMinutes: 10 })).expect(200);

    const bigPart = (await auth(api().post("/parts").send({ partNo: `SCH-BIG-${STAMP}`, revision: "A", name: "Aşım Parça" }))).body.id;

    const day = new Date();
    day.setHours(0, 0, 0, 0);
    const bigWo = await releasedWorkOrder(bigPart, bigMachine, [{ seq: 1, name: "Freze", standardMinutes: 500 }]);
    await auth(
      api().patch(`/work-orders/${bigWo.body.id}/schedule`).send({
        plannedStartDate: day.toISOString(),
        plannedEndDate: day.toISOString(),
      }),
    ).expect(200);

    const capacity = await auth(
      api().get(`/scheduling/capacity?from=${day.toISOString()}&to=${day.toISOString()}`),
    ).expect(200);
    const row = capacity.body.find((r: { machineId: string }) => r.machineId === bigMachine);
    expect(row).toMatchObject({ loadMinutes: 500, capacityMinutes: 10, overloaded: true });

    await prisma.workOrderOperation.deleteMany({ where: { workOrderId: bigWo.body.id } });
    await prisma.workOrderCostBaseline.deleteMany({ where: { workOrderId: bigWo.body.id } });
    await prisma.workOrder.deleteMany({ where: { id: bigWo.body.id } });
    await prisma.productionDefinition.deleteMany({ where: { partId: bigPart } });
    await prisma.bomHeader.deleteMany({ where: { partId: bigPart } });
    await prisma.recipeHeader.deleteMany({ where: { partId: bigPart } });
    await prisma.machine.deleteMany({ where: { id: bigMachine } });
    await prisma.part.deleteMany({ where: { id: bigPart } });
  });

  describe("MRP II sonlu kapasite çizelgeleme", () => {
    // Deterministic horizon: a Monday 05:00Z so the 08:00-Istanbul fallback window is the first slot.
    const horizonStart = new Date("2030-01-07T05:00:00.000Z");
    let runId: string;

    it("commit:false simülasyonu operasyon pencerelerini döner ama hiçbir şey yazmaz", async () => {
      const res = await auth(api().post("/scheduling/runs").send({ horizonStart: horizonStart.toISOString(), horizonDays: 7, dispatchRule: "EDD", commit: false })).expect(201);

      expect(res.body.committed).toBe(false);
      expect(res.body.runId).toBeNull();
      const op = res.body.operations.find((o: { workOrderId: string }) => o.workOrderId === workOrderId);
      expect(op).toBeDefined();
      expect(op.minutes).toBe(100);
      expect(new Date(op.end).getTime() - new Date(op.start).getTime()).toBe(100 * 60_000);
      expect(new Date(op.start).getTime()).toBeGreaterThanOrEqual(horizonStart.getTime());

      const stored = await prisma.workOrderOperation.findFirst({ where: { workOrderId } });
      expect(stored?.plannedStartAt).toBeNull();
      expect(await prisma.schedulingRun.count({ where: { horizonStart } })).toBe(0);
    });

    it("commit:true SchedulingRun yazar, operasyon ve iş emri pencerelerini günceller, makine kuyruğunda görünür", async () => {
      const res = await auth(api().post("/scheduling/runs").send({ horizonStart: horizonStart.toISOString(), horizonDays: 7, dispatchRule: "PRIORITY", commit: true })).expect(201);
      runId = res.body.runId;
      expect(runId).toBeTruthy();

      const op = res.body.operations.find((o: { workOrderId: string }) => o.workOrderId === workOrderId);
      const stored = await prisma.workOrderOperation.findFirstOrThrow({ where: { workOrderId } });
      expect(stored.plannedStartAt?.toISOString()).toBe(op.start);
      expect(stored.plannedEndAt?.toISOString()).toBe(op.end);
      expect(stored.schedulingRunId).toBe(runId);

      const wo = await prisma.workOrder.findUniqueOrThrow({ where: { id: workOrderId } });
      expect(wo.plannedStartDate?.toISOString()).toBe(op.start);
      expect(wo.plannedEndDate?.toISOString()).toBe(op.end);

      const queue = await auth(api().get(`/scheduling/machine-queue?from=${horizonStart.toISOString()}&to=${new Date(horizonStart.getTime() + 7 * 86_400_000).toISOString()}`)).expect(200);
      const row = queue.body.find((r: { machineId: string }) => r.machineId === machineId);
      expect(row).toBeDefined();
      expect(row.operations.map((o: { workOrderId: string }) => o.workOrderId)).toContain(workOrderId);

      const runs = await auth(api().get("/scheduling/runs")).expect(200);
      expect(runs.body.find((r: { id: string }) => r.id === runId)).toMatchObject({ dispatchRule: "PRIORITY", committed: true });
      const detail = await auth(api().get(`/scheduling/runs/${runId}`)).expect(200);
      expect(detail.body.result.summary.scheduledOps).toBeGreaterThanOrEqual(1);
    });

    it("kapasite raporu artık uygulanmış operasyon penceresinin gününe yük yazar", async () => {
      const capacity = await auth(api().get(`/scheduling/capacity?from=${horizonStart.toISOString()}&to=${new Date(horizonStart.getTime() + 7 * 86_400_000).toISOString()}`)).expect(200);
      const rows = capacity.body.filter((r: { machineId: string }) => r.machineId === machineId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ date: "2030-01-07", loadMinutes: 100 });
    });

    it("geçersiz sevk kuralı 400 döner", async () => {
      await auth(api().post("/scheduling/runs").send({ dispatchRule: "RANDOM", commit: false })).expect(400);
    });

    afterAll(async () => {
      await prisma.workOrderOperation.updateMany({ where: { schedulingRunId: runId }, data: { schedulingRunId: null, plannedStartAt: null, plannedEndAt: null } }).catch(() => undefined);
      await prisma.schedulingRun.deleteMany({ where: { id: runId } }).catch(() => undefined);
    });
  });
});
