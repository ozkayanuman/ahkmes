import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();

describe("Canonical shift report (e2e)", () => {
  let app: INestApplication; let prisma: PrismaService; let token: string; let tenantId: string; let plantId: string; let partId: string; let machineId: string; let workOrderId: string; let operationId: string;
  const api = () => request(app.getHttpServer());
  const auth = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);
  const query = () => { const asOf = new Date(); return new URLSearchParams({ plantId, date: asOf.toISOString().slice(0, 10), asOf: asOf.toISOString() }); };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile(); app = module.createNestApplication(); await app.init(); prisma = app.get(PrismaService);
    token = (await api().post("/auth/login").send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).body.accessToken;
    tenantId = (await prisma.user.findFirstOrThrow({ where: { email: ADMIN_EMAIL }, select: { tenantId: true } })).tenantId;
    const now = new Date(); const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); const end = new Date(start.getTime() + 24 * 3600 * 1000);
    plantId = (await prisma.plant.create({ data: { tenantId, name: `Shift Plant ${STAMP}`, timezone: "UTC" } })).id;
    const calendar = await prisma.plantProductionCalendar.create({ data: { tenantId, plantId, name: "Shift Calendar", timezone: "UTC", weeklyWorkingDays: [now.getUTCDay()] } });
    await prisma.productionShift.create({ data: { tenantId, plantId, calendarId: calendar.id, code: "DAY", name: "Day", startMinute: 0, endMinute: 23 * 60 + 59 } });
    partId = (await prisma.part.create({ data: { tenantId, partNo: `SR-${STAMP}`, revision: "A", name: "Shift Part", unit: "EA" } })).id;
    machineId = (await prisma.machine.create({ data: { tenantId, plantId, name: `Shift Machine ${STAMP}`, model: "Test" } })).id;
    workOrderId = (await prisma.workOrder.create({ data: { tenantId, plantId, machineId, partId, woNo: `SR-WO-${STAMP}`, quantity: 10, dueDate: end, plannedStartDate: start, plannedEndDate: end } })).id;
    operationId = (await prisma.workOrderOperation.create({ data: { tenantId, workOrderId, seq: 10, name: "OP10", idealCycleTimeSec: 60 } })).id;
    const userId = (await prisma.user.findFirstOrThrow({ where: { tenantId }, select: { id: true } })).id;
    const run = await prisma.productionRun.create({ data: { tenantId, workOrderId, operationId, machineId, operatorId: userId, startedAt: new Date(now.getTime() - 20 * 60 * 1000), endedAt: new Date(now.getTime() - 5 * 60 * 1000) } });
    await prisma.productionExecutionEvent.createMany({ data: [{ tenantId, workOrderId, operationId, productionRunId: run.id, type: "START", idempotencyKey: `sr-start-${STAMP}`, actorId: userId, createdAt: run.startedAt }, { tenantId, workOrderId, operationId, productionRunId: run.id, type: "COMPLETE", idempotencyKey: `sr-complete-${STAMP}`, actorId: userId, createdAt: run.endedAt! }] });
    await prisma.productionReport.create({ data: { tenantId, workOrderId, operationId, productionRunId: run.id, goodQty: 10, scrapQty: 0, reworkQty: 0, idempotencyKey: `sr-report-${STAMP}`, reportedById: userId, createdAt: new Date(now.getTime() - 4 * 60 * 1000) } });
  });
  afterAll(async () => { await prisma.productionReport.deleteMany({ where: { workOrderId } }); await prisma.productionExecutionEvent.deleteMany({ where: { workOrderId } }); await prisma.productionRun.deleteMany({ where: { workOrderId } }); await prisma.workOrderOperation.deleteMany({ where: { id: operationId } }); await prisma.workOrder.deleteMany({ where: { id: workOrderId } }); await prisma.machine.deleteMany({ where: { id: machineId } }); await prisma.productionShift.deleteMany({ where: { plantId } }); await prisma.plantProductionCalendar.deleteMany({ where: { plantId } }); await prisma.plant.deleteMany({ where: { id: plantId } }); await prisma.part.deleteMany({ where: { id: partId } }); await app.close(); });
  it("requires explicit scope and projects the plant calendar shift from canonical facts", async () => { await auth(api().get("/shift-report")).expect(400); const res = await auth(api().get(`/shift-report?${query()}`)).expect(200); expect(res.body).toEqual([expect.objectContaining({ shift: "DAY", goodCount: 10, scrapCount: 0, dataQuality: expect.any(String) })]); });
});
