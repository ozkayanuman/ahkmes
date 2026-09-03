import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module";
import { resolveProductionLossCategory } from "../src/downtime/downtime.service";
import { OeeCalculationService } from "../src/oee/oee-calculation.service";
import { OeeSnapshotSynchronization } from "../src/oee/oee-snapshot-synchronization";
import { OeeService } from "../src/oee/oee.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { WorkOrdersService } from "../src/work-orders/work-orders.service";

const stamp = Date.now();
const at = (value: string) => new Date(value);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("CNC-V1-08R canonical OEE calculation (PostgreSQL e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let calculation: OeeCalculationService;
  let oee: OeeService;
  let workOrders: WorkOrdersService;
  let snapshotGate: { reached: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | undefined;
  let canonicalFixture: { tenantId: string; plantId: string; workOrderId: string; operationId: string; runId: string; actorId: string };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OeeSnapshotSynchronization)
      .useValue({
        async reached(point: string): Promise<void> {
          if (point !== "SNAPSHOT_ESTABLISHED" || !snapshotGate) return;
          snapshotGate.reached.resolve();
          await snapshotGate.release.promise;
        },
      })
      .compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    calculation = app.get(OeeCalculationService);
    oee = app.get(OeeService);
    workOrders = app.get(WorkOrdersService);
  });

  afterAll(async () => app.close());

  it("uses one asOf cutoff with immutable evidence and canonical calendar breaks", async () => {
    const tenantId = `cnc-v1-08r-${stamp}`;
    await prisma.tenant.create({ data: { id: tenantId, name: "OEE E2E", timezone: "Europe/Istanbul" } });
    const actor = await prisma.user.create({
      data: { tenantId, email: `oee-${stamp}@test.local`, name: "OEE Admin", passwordHash: "test", role: "ADMIN" },
    });
    const plant = await prisma.plant.create({ data: { tenantId, name: "OEE Ankara", timezone: "Europe/Istanbul" } });
    const machine = await prisma.machine.create({ data: { tenantId, plantId: plant.id, name: `OEE Machine ${stamp}`, model: "Test" } });
    const part = await prisma.part.create({ data: { tenantId, partNo: `OEE-${stamp}`, revision: "A", name: "OEE Part", unit: "EA" } });
    const calendar = await prisma.plantProductionCalendar.create({
      data: { tenantId, plantId: plant.id, name: "OEE calendar", timezone: "Europe/Istanbul", weeklyWorkingDays: [3] },
    });
    await prisma.productionShift.create({
      data: {
        tenantId,
        plantId: plant.id,
        calendarId: calendar.id,
        code: "DAY",
        name: "Day",
        startMinute: 8 * 60,
        endMinute: 12 * 60,
        breaks: { create: [{ name: "Tea break", startMinute: 10 * 60, endMinute: 10 * 60 + 15 }] },
      },
    });
    const workOrder = await prisma.workOrder.create({
      data: {
        tenantId,
        woNo: `OEE-WO-${stamp}`,
        partId: part.id,
        plantId: plant.id,
        quantity: 100,
        dueDate: at("2026-08-27T00:00:00.000Z"),
        plannedStartDate: at("2026-08-26T05:00:00.000Z"),
        plannedEndDate: at("2026-08-26T09:00:00.000Z"),
        createdAt: at("2026-08-01T00:00:00.000Z"),
      },
    });
    const operation = await prisma.workOrderOperation.create({
      data: { tenantId, workOrderId: workOrder.id, seq: 10, name: "OP10", idealCycleTimeSec: 120 },
    });
    const run = await prisma.productionRun.create({
      data: { tenantId, workOrderId: workOrder.id, operationId: operation.id, operatorId: actor.id, startedAt: at("2026-08-26T05:00:00.000Z"), endedAt: at("2026-08-26T09:00:00.000Z") },
    });
    await prisma.productionExecutionEvent.createMany({
      data: [
        { tenantId, workOrderId: workOrder.id, operationId: operation.id, productionRunId: run.id, type: "START", idempotencyKey: `start-${stamp}`, actorId: actor.id, createdAt: at("2026-08-26T05:00:00.000Z") },
        { tenantId, workOrderId: workOrder.id, operationId: operation.id, productionRunId: run.id, type: "PAUSE", reasonCode: "OPERATOR_BREAK", idempotencyKey: `pause-${stamp}`, actorId: actor.id, createdAt: at("2026-08-26T07:00:00.000Z") },
        { tenantId, workOrderId: workOrder.id, operationId: operation.id, productionRunId: run.id, type: "RESUME", idempotencyKey: `resume-${stamp}`, actorId: actor.id, createdAt: at("2026-08-26T07:15:00.000Z") },
        { tenantId, workOrderId: workOrder.id, operationId: operation.id, productionRunId: run.id, type: "COMPLETE", idempotencyKey: `complete-${stamp}`, actorId: actor.id, createdAt: at("2026-08-26T09:00:00.000Z") },
      ],
    });
    const downtimeReason = await prisma.downtimeReason.create({
      data: { tenantId, code: `SPINDLE-${stamp}`, label: "Spindle failure", category: "UNPLANNED", lossCategory: "UNPLANNED_BREAKDOWN" },
    });
    await prisma.downtimeEvent.create({
      data: {
        tenantId,
        machineId: machine.id,
        workOrderId: workOrder.id,
        reasonId: downtimeReason.id,
        source: "ALARM",
        ownership: "MES",
        startedAt: at("2026-08-26T05:30:00.000Z"),
        endedAt: at("2026-08-26T06:00:00.000Z"),
        createdAt: at("2026-08-26T05:30:00.000Z"),
      },
    });
    await prisma.qualityHold.create({
      data: {
        tenantId,
        target: "WORK_ORDER",
        workOrderId: workOrder.id,
        operationId: operation.id,
        quantity: 100,
        reason: "Required inspection failed",
        source: "E2E",
        status: "RELEASED",
        idempotencyKey: `quality-hold-${stamp}`,
        createdById: actor.id,
        releasedById: actor.id,
        createdAt: at("2026-08-26T06:00:00.000Z"),
        releasedAt: at("2026-08-26T06:15:00.000Z"),
      },
    });
    await prisma.productionReport.createMany({
      data: [
        { tenantId, workOrderId: workOrder.id, operationId: operation.id, productionRunId: run.id, goodQty: 100, scrapQty: 0, reworkQty: 0, idempotencyKey: `report-in-cutoff-${stamp}`, reportedById: actor.id, createdAt: at("2026-08-26T08:59:00.000Z") },
        { tenantId, workOrderId: workOrder.id, operationId: operation.id, productionRunId: run.id, goodQty: 500, scrapQty: 0, reworkQty: 0, idempotencyKey: `report-after-cutoff-${stamp}`, reportedById: actor.id, createdAt: at("2026-08-26T09:01:00.000Z") },
      ],
    });

    canonicalFixture = {
      tenantId,
      plantId: plant.id,
      workOrderId: workOrder.id,
      operationId: operation.id,
      runId: run.id,
      actorId: actor.id,
    };

    const result = await calculation.calculate({
      tenantId,
      plantId: plant.id,
      from: at("2026-08-26T05:00:00.000Z"),
      to: at("2026-08-26T09:00:00.000Z"),
      asOf: at("2026-08-26T09:00:00.000Z"),
    });

    expect(result.plannedTime.plannedProductionTimeSeconds).toBe(3.75 * 3_600);
    expect(result.timeline.durationByBucket.SCHEDULED_NON_PRODUCTION).toBe(15 * 60);
    expect(result.timeline.durationByBucket.UNPLANNED_BREAKDOWN).toBe(30 * 60);
    expect(result.timeline.durationByBucket.QUALITY_HOLD).toBe(15 * 60);
    expect(result.metrics.facts.totalCount).toBe(100);
    expect(result.metrics.availability.value).toBeCloseTo(10_800 / 13_500, 10);
    expect(result.metrics.performance.value).toBeCloseTo(12_000 / 10_800, 10);
  });

  it("keeps general and work-order OEE adapters equal for the same canonical context", async () => {
    const context = {
      plantId: canonicalFixture.plantId,
      from: at("2026-08-26T05:00:00.000Z"),
      to: at("2026-08-26T09:00:00.000Z"),
      asOf: at("2026-08-26T09:00:00.000Z"),
    };

    const general = await oee.calculate({ tenantId: canonicalFixture.tenantId, ...context });
    const workOrder = await workOrders.oee(canonicalFixture.tenantId, canonicalFixture.workOrderId, context);

    expect(workOrder.canonical.metrics).toEqual(general.metrics);
    expect(workOrder.goodCount).toBe(general.metrics.facts.goodCount);
    expect(workOrder.oee).toBe(general.metrics.oee.value);
    expect(workOrder.asOf).toEqual(context.asOf);
  });

  it("keeps one repeatable-read fact snapshot while an eligible report is committed concurrently", async () => {
    snapshotGate = { reached: deferred(), release: deferred() };
    const calculationPromise = calculation.calculate({
      tenantId: canonicalFixture.tenantId,
      plantId: canonicalFixture.plantId,
      from: at("2026-08-26T05:00:00.000Z"),
      to: at("2026-08-26T09:00:00.000Z"),
      asOf: at("2026-08-26T09:00:00.000Z"),
    });

    await snapshotGate.reached.promise;
    await prisma.productionReport.create({
      data: {
        tenantId: canonicalFixture.tenantId,
        workOrderId: canonicalFixture.workOrderId,
        operationId: canonicalFixture.operationId,
        productionRunId: canonicalFixture.runId,
        goodQty: 600,
        scrapQty: 0,
        reworkQty: 0,
        idempotencyKey: `report-concurrent-${stamp}`,
        reportedById: canonicalFixture.actorId,
        createdAt: at("2026-08-26T08:58:00.000Z"),
      },
    });
    snapshotGate.release.resolve();

    const result = await calculationPromise;
    snapshotGate = undefined;

    expect(result.metrics.facts.totalCount).toBe(100);
  });

  it("persists the optional OEE loss mapping without rewriting legacy downtime categories", async () => {
    const tenantId = `cnc-v1-08r-loss-${stamp}`;
    await prisma.tenant.create({ data: { id: tenantId, name: "OEE Loss E2E", timezone: "Europe/Istanbul" } });
    const mapped = await prisma.downtimeReason.create({
      data: { tenantId, code: "PM", label: "Planned maintenance", category: "PLANNED", lossCategory: "PLANNED_MAINTENANCE" },
    });
    const unmapped = await prisma.downtimeReason.create({
      data: { tenantId, code: "UNKNOWN", label: "Unknown loss", category: "UNPLANNED" },
    });

    expect(mapped.category).toBe("PLANNED");
    expect(resolveProductionLossCategory(mapped)).toBe("PLANNED_MAINTENANCE");
    expect(unmapped.lossCategory).toBeNull();
    expect(resolveProductionLossCategory(unmapped)).toBe("OTHER_UNPLANNED");
  });
});
