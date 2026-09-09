import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { OeeCalculationService } from "../src/oee/oee-calculation.service";
import { PrismaService } from "../src/prisma/prisma.service";

describe("CNC-V1-00 restored deployment verification", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let calculation: OeeCalculationService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    calculation = app.get(OeeCalculationService);
  });
  afterAll(async () => app.close());

  it("preserves customer, manufacturing and legacy authorization state after isolated restore", async () => {
    const login = await request(app.getHttpServer()).post("/auth/login").send({ email: process.env.BOOTSTRAP_ADMIN_EMAIL, password: process.env.BOOTSTRAP_ADMIN_PASSWORD }).expect(201);
    const tenantId = (await prisma.user.findUniqueOrThrow({ where: { email: process.env.BOOTSTRAP_ADMIN_EMAIL! }, select: { tenantId: true } })).tenantId;
    expect(await prisma.tenant.findUnique({ where: { id: tenantId } })).toEqual(expect.objectContaining({ code: process.env.BOOTSTRAP_TENANT_CODE }));
    expect(await prisma.machine.count({ where: { tenantId } })).toBeGreaterThan(0);
    expect(await prisma.part.count({ where: { tenantId } })).toBeGreaterThan(0);
    expect(await prisma.tenantModuleEntitlement.count({ where: { tenantId, isEnabled: true } })).toBeGreaterThan(0);
    // CNC-V1-06 data is intentionally created by the preceding isolated quality
    // E2E.  Verify the migration's linked quality graph survived pg_dump/restore.
    expect(await prisma.qualityPlan.count()).toBeGreaterThan(0);
    expect(await prisma.productionQualityRequirement.count()).toBeGreaterThan(0);
    expect(await prisma.inspectionLot.count()).toBeGreaterThan(0);
    expect(await prisma.inspectionMeasurement.count()).toBeGreaterThan(0);
    expect(await prisma.nonConformance.count({ where: { inspectionLot: { isNot: null } } })).toBeGreaterThan(0);
    expect(await prisma.qualityHold.count()).toBeGreaterThan(0);
    expect(await prisma.qualityDisposition.count()).toBeGreaterThan(0);
    expect(await prisma.reworkRequirement.count()).toBeGreaterThan(0);
    // CNC-V1-04 state, immutable reports and event history are restored as a
    // coherent graph rather than merely proving the migration table exists.
    expect(await prisma.productionRun.count({ where: { operationId: { not: null } } })).toBeGreaterThan(0);
    expect(await prisma.productionExecutionEvent.count()).toBeGreaterThan(0);
    expect(await prisma.productionReport.count()).toBeGreaterThan(0);
    expect(await prisma.reworkRequirement.count({ where: { reworkRunId: { not: null }, reworkOperationId: { not: null } } })).toBeGreaterThan(0);
    // CNC-V1-07R data is created by the preceding isolated CMMS A-Z suite.
    // Verify the maintainable Machine identity and its complete, timestamped
    // maintenance graph survived the second-PostgreSQL restore.
    const maintainedMachine = await prisma.machine.findFirst({
      where: { assetCode: { not: null }, maintenanceBreakdowns: { some: {} } },
      include: {
        maintenanceBreakdowns: true,
        maintenanceOrders: { include: { tasks: true, technicianAssignments: true, laborEntries: true, spareLines: { include: { transactions: true } } } },
        downtimeEvents: { where: { ownership: "MAINTENANCE" } },
        returnToServiceEvents: true,
      },
    });
    expect(maintainedMachine).toBeTruthy();
    expect(maintainedMachine!.maintenanceBreakdowns.length).toBeGreaterThan(0);
    expect(maintainedMachine!.downtimeEvents.length).toBeGreaterThan(0);
    expect(maintainedMachine!.maintenanceOrders.some((order) => order.tasks.length > 0)).toBe(true);
    expect(maintainedMachine!.maintenanceOrders.some((order) => order.technicianAssignments.length > 0)).toBe(true);
    expect(maintainedMachine!.maintenanceOrders.some((order) => order.laborEntries.length > 0)).toBe(true);
    expect(maintainedMachine!.maintenanceOrders.some((order) => order.spareLines.some((line) => line.transactions.length > 0))).toBe(true);
    expect(maintainedMachine!.returnToServiceEvents.length).toBeGreaterThan(0);
    expect(await prisma.maintenancePlan.count()).toBeGreaterThan(0);
    // CNC-V1-05 controller evidence is operational context only, but it must
    // survive restore with its tenant/machine relationship intact.
    const controllerObservation = await prisma.machineControllerObservation.findFirst({ include: { machine: { select: { tenantId: true } } } });
    expect(controllerObservation).toBeTruthy();
    expect(controllerObservation!.machine.tenantId).toBe(controllerObservation!.tenantId);
    expect((await request(app.getHttpServer()).get("/health/ready").expect(200)).body).toEqual(expect.objectContaining({ status: "ok" }));
  });

  it("preserves canonical OEE source evidence and recalculates it after isolated restore", async () => {
    const workOrder = await prisma.workOrder.findFirst({
      where: { woNo: { startsWith: "OEE-WO-" } },
      select: { tenantId: true, plantId: true, id: true },
      orderBy: { createdAt: "asc" },
    });
    expect(workOrder).toBeTruthy();
    const plantId = workOrder!.plantId;
    if (!plantId) throw new Error("Restored canonical OEE work order has no plant");

    const result = await calculation.calculate({
      tenantId: workOrder!.tenantId,
      plantId,
      workOrderId: workOrder!.id,
      from: new Date("2026-08-26T05:00:00.000Z"),
      to: new Date("2026-08-26T09:00:00.000Z"),
      asOf: new Date("2026-08-26T09:00:00.000Z"),
    });

    expect(await prisma.productionExecutionEvent.count({ where: { workOrderId: workOrder!.id } })).toBeGreaterThanOrEqual(4);
    expect(await prisma.productionReport.count({ where: { workOrderId: workOrder!.id } })).toBeGreaterThanOrEqual(3);
    expect(await prisma.downtimeEvent.count({ where: { workOrderId: workOrder!.id, reason: { lossCategory: "UNPLANNED_BREAKDOWN" } } })).toBe(1);
    expect(await prisma.qualityHold.count({ where: { workOrderId: workOrder!.id } })).toBe(1);
    expect(result.metrics.facts.goodCount).toBe(700);
    expect(result.timeline.durationByBucket.UNPLANNED_BREAKDOWN).toBe(30 * 60);
    expect(result.timeline.durationByBucket.QUALITY_HOLD).toBe(15 * 60);
  });
});
