import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();

describe("Canonical OEE trend & loss Pareto (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let tenantId: string;
  let plantId: string;
  let partId: string;
  let machineId: string;
  let workOrderId: string;
  let operationId: string;

  const auth = (r: request.Test) => r.set("Authorization", `Bearer ${adminToken}`);
  const api = () => request(app.getHttpServer());
  const oeeQuery = () => {
    const asOf = new Date();
    const from = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()));
    return new URLSearchParams({ plantId, from: from.toISOString(), to: asOf.toISOString(), asOf: asOf.toISOString() });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const login = await api().post("/auth/login").send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    adminToken = login.body.accessToken;
    tenantId = (await prisma.user.findFirstOrThrow({ where: { email: ADMIN_EMAIL }, select: { tenantId: true } })).tenantId;

    const now = new Date();
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const plannedEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const plant = await prisma.plant.create({ data: { tenantId, name: `OEE Trend Plant ${STAMP}`, timezone: "UTC" } });
    plantId = plant.id;
    const calendar = await prisma.plantProductionCalendar.create({
      data: { tenantId, plantId, name: "OEE Trend Calendar", timezone: "UTC", weeklyWorkingDays: [now.getUTCDay()] },
    });
    await prisma.productionShift.create({
      data: { tenantId, plantId, calendarId: calendar.id, code: `FULL-${STAMP}`, name: "Full day", startMinute: 0, endMinute: 23 * 60 + 59 },
    });
    const part = await prisma.part.create({ data: { tenantId, partNo: `OEET-${STAMP}`, revision: "A", name: "OEE Trend Part", unit: "EA" } });
    partId = part.id;
    const machine = await prisma.machine.create({ data: { tenantId, plantId, name: `OEE Trend Machine ${STAMP}`, model: "Test" } });
    machineId = machine.id;
    const workOrder = await prisma.workOrder.create({
      data: { tenantId, plantId, machineId, partId, woNo: `OEET-WO-${STAMP}`, quantity: 10, dueDate: plannedEnd, plannedStartDate: dayStart, plannedEndDate: plannedEnd },
    });
    workOrderId = workOrder.id;
    const operation = await prisma.workOrderOperation.create({ data: { tenantId, workOrderId, seq: 10, name: "OP10", idealCycleTimeSec: 120 } });
    operationId = operation.id;
    const run = await prisma.productionRun.create({ data: { tenantId, workOrderId, operationId, machineId, operatorId: (await prisma.user.findFirstOrThrow({ where: { tenantId }, select: { id: true } })).id, startedAt: new Date(now.getTime() - 60 * 60 * 1000), endedAt: new Date(now.getTime() - 5 * 60 * 1000) } });
    await prisma.productionExecutionEvent.createMany({
      data: [
        { tenantId, workOrderId, operationId, productionRunId: run.id, type: "START", idempotencyKey: `trend-start-${STAMP}`, actorId: (await prisma.user.findFirstOrThrow({ where: { tenantId }, select: { id: true } })).id, createdAt: new Date(now.getTime() - 60 * 60 * 1000) },
        { tenantId, workOrderId, operationId, productionRunId: run.id, type: "COMPLETE", idempotencyKey: `trend-complete-${STAMP}`, actorId: (await prisma.user.findFirstOrThrow({ where: { tenantId }, select: { id: true } })).id, createdAt: new Date(now.getTime() - 5 * 60 * 1000) },
      ],
    });
    await prisma.productionReport.create({ data: { tenantId, workOrderId, operationId, productionRunId: run.id, goodQty: 10, scrapQty: 0, reworkQty: 0, idempotencyKey: `trend-report-${STAMP}`, reportedById: (await prisma.user.findFirstOrThrow({ where: { tenantId }, select: { id: true } })).id, createdAt: new Date(now.getTime() - 4 * 60 * 1000) } });
    const reason = await prisma.downtimeReason.create({ data: { tenantId, code: `TOOL-BREAK-${STAMP}`, label: "Tool break", category: "UNPLANNED", lossCategory: "UNPLANNED_BREAKDOWN" } });
    await prisma.downtimeEvent.create({ data: { tenantId, machineId, workOrderId, reasonId: reason.id, source: "ALARM", ownership: "MES", startedAt: new Date(now.getTime() - 50 * 60 * 1000), endedAt: new Date(now.getTime() - 40 * 60 * 1000), createdAt: new Date(now.getTime() - 50 * 60 * 1000) } });
  });

  afterAll(async () => {
    await prisma.downtimeEvent.deleteMany({ where: { workOrderId } }).catch(() => undefined);
    await prisma.downtimeReason.deleteMany({ where: { tenantId, code: `TOOL-BREAK-${STAMP}` } }).catch(() => undefined);
    await prisma.productionReport.deleteMany({ where: { workOrderId } }).catch(() => undefined);
    await prisma.productionExecutionEvent.deleteMany({ where: { workOrderId } }).catch(() => undefined);
    await prisma.productionRun.deleteMany({ where: { workOrderId } }).catch(() => undefined);
    await prisma.workOrderOperation.deleteMany({ where: { id: operationId } }).catch(() => undefined);
    await prisma.workOrder.deleteMany({ where: { id: workOrderId } }).catch(() => undefined);
    await prisma.machine.deleteMany({ where: { id: machineId } }).catch(() => undefined);
    await prisma.productionShift.deleteMany({ where: { plantId } }).catch(() => undefined);
    await prisma.plantProductionCalendar.deleteMany({ where: { plantId } }).catch(() => undefined);
    await prisma.plant.deleteMany({ where: { id: plantId } }).catch(() => undefined);
    await prisma.part.deleteMany({ where: { id: partId } }).catch(() => undefined);
    await app.close();
  });

  it("GET /oee/trend projects today's canonical OEE evidence", async () => {
    const res = await auth(api().get(`/oee/trend?${oeeQuery()}`)).expect(200);
    const today = new Date().toISOString().slice(0, 10);
    const bucket = res.body.find((item: { date: string }) => item.date === today);
    expect(bucket).toMatchObject({ goodCount: 10, downtimeSeconds: 10 * 60 });
    expect(bucket.oee).not.toBeNull();
  });

  it("GET /oee/downtime-pareto projects structured downtime provenance", async () => {
    const res = await auth(api().get(`/oee/downtime-pareto?${oeeQuery()}`)).expect(200);
    expect(res.body).toContainEqual({ reason: "Tool break", totalSeconds: 10 * 60, count: 1 });
  });
});
