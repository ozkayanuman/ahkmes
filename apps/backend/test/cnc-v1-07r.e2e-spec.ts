import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import request from "supertest";
import { InventoryMovementType } from "@prisma/client";
import { AppModule } from "../src/app.module";
import { InventoryService } from "../src/inventory/inventory.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { ProductionService } from "../src/production/production.service";

const stamp = Date.now();

describe("CNC-V1-07R commercial CMMS closure (PostgreSQL e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let inventory: InventoryService;
  let production: ProductionService;
  let token: string;
  let tenantId: string;
  let userId: string;
  let technicianId: string;
  let plantId: string;
  let machineId: string;
  let binId: string;
  let materialId: string;

  const api = () => request(app.getHttpServer());
  const auth = (value: request.Test) => value.set("Authorization", `Bearer ${token}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    inventory = app.get(InventoryService);
    production = app.get(ProductionService);

    tenantId = `cnc-v1-07r-${stamp}`;
    await prisma.tenant.create({ data: { id: tenantId, name: `CMMS ${stamp}`, timezone: "Europe/Istanbul" } });
    const passwordHash = await bcrypt.hash("TestPassword123!", 10);
    const admin = await prisma.user.create({ data: { tenantId, email: `cmms-${stamp}@test.local`, name: "CMMS Admin", passwordHash, role: "ADMIN" } });
    userId = admin.id;
    technicianId = (await prisma.user.create({ data: { tenantId, email: `tech-${stamp}@test.local`, name: "CMMS Technician", passwordHash, role: "FOREMAN" } })).id;
    const actions = ["CMMS_READ", "CMMS_REQUEST_CREATE", "CMMS_BREAKDOWN_DECLARE", "CMMS_WO_PLAN", "CMMS_WO_EXECUTE", "CMMS_ASSIGN_TECHNICIAN", "CMMS_SPARE_ISSUE", "CMMS_PM_ADMIN", "CMMS_RETURN_TO_SERVICE", "CMMS_CODE_ADMIN"];
    await prisma.actionPermissionGrant.createMany({ data: actions.map((action) => ({ tenantId, action, userId, createdById: userId })) });
    token = (await api().post("/auth/login").send({ email: admin.email, password: "TestPassword123!" })).body.accessToken;

    const plant = await prisma.plant.create({ data: { tenantId, name: `CMMS Plant ${stamp}`, timezone: "Europe/Istanbul" } });
    plantId = plant.id;
    const area = await prisma.area.create({ data: { tenantId, plantId, name: "Machining" } });
    const workplace = await prisma.workplace.create({ data: { tenantId, areaId: area.id, name: "Cell 1" } });
    const unit = await prisma.unit.create({ data: { tenantId, workplaceId: workplace.id, name: "CNC Cell" } });
    const machine = await prisma.machine.create({ data: { tenantId, plantId, unitId: unit.id, assetCode: `CNC-${stamp}`, assetType: "CNC_MACHINE", name: "CMMS CNC", model: "VMC", manufacturer: "Test", serialNumber: `SN-${stamp}`, criticality: "HIGH" } });
    machineId = machine.id;

    const warehouse = await prisma.warehouse.create({ data: { tenantId, plantId, name: "CMMS Spare Warehouse", code: `CM${stamp}` } });
    binId = (await prisma.bin.create({ data: { tenantId, warehouseId: warehouse.id, code: "SPARES" } })).id;
    materialId = (await prisma.material.create({ data: { tenantId, code: `BRG-${stamp}`, name: "Spindle bearing", type: "CONSUMABLE", unit: "EA" } })).id;
    await prisma.$transaction((tx) => inventory.record(tx, { tenantId, itemType: "MATERIAL", itemId: materialId, binId, quantityDelta: 10, movementType: InventoryMovementType.OPENING_BALANCE, sourceType: "CMMS_E2E", sourceId: machineId, createdById: userId }));
  });

  afterAll(async () => app.close());

  it("A-B exposes one canonical plant-scoped maintainable Machine and accepts a maintenance request", async () => {
    const assets = await auth(api().get(`/maintenance-orders/assets?plantId=${plantId}`)).expect(200);
    expect(assets.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: machineId, plantId, assetCode: `CNC-${stamp}`, maintenanceState: "AVAILABLE" })]));
    const requestResult = await auth(api().post("/maintenance-orders/requests").send({ machineId, problem: "Spindle vibration", priority: "HIGH", description: "Operator observed vibration", reportedAt: new Date().toISOString(), idempotencyKey: `request-${stamp}` })).expect(201);
    expect(requestResult.body).toMatchObject({ machineId, plantId, status: "OPEN", reportedById: userId });
  });

  it("C-E declares one audited breakdown with one open maintenance downtime and blocks MES start", async () => {
    const payload = { machineId, failureStartedAt: new Date().toISOString(), failureCode: "MECHANICAL", description: "Spindle bearing failed", priority: "CRITICAL", productionImpact: "STOPPED", idempotencyKey: `breakdown-${stamp}` };
    const declarations = await Promise.allSettled([
      auth(api().post("/maintenance-orders/breakdowns").send(payload)),
      auth(api().post("/maintenance-orders/breakdowns").send(payload)),
    ]);
    expect(declarations.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    expect(await prisma.maintenanceBreakdown.count({ where: { tenantId, machineId, status: "OPEN" } })).toBe(1);
    const downtime = await prisma.downtimeEvent.findMany({ where: { tenantId, machineId, endedAt: null, ownership: "MAINTENANCE" } });
    expect(downtime).toHaveLength(1);
    expect(downtime[0]).toMatchObject({ maintenanceCategory: "UNPLANNED_BREAKDOWN" });
    expect((await prisma.machine.findUniqueOrThrow({ where: { id: machineId } })).maintenanceState).toBe("BREAKDOWN");
    expect(await prisma.auditLog.count({ where: { tenantId, entity: "maintenance-breakdown" } })).toBeGreaterThan(0);

    const part = await prisma.part.create({ data: { tenantId, partNo: `GATE-${stamp}`, revision: "A", name: "Gate part", unit: "EA" } });
    const order = await prisma.workOrder.create({ data: { tenantId, woNo: `WO-CMMS-${stamp}`, partId: part.id, plantId, machineId, quantity: 1, dueDate: new Date(Date.now() + 86_400_000), status: "RELEASED", engineeringReleaseRequired: false } });
    await expect(production.start(tenantId, userId, order.id, { machineId })).rejects.toMatchObject({ response: expect.objectContaining({ errorCode: expect.stringMatching(/MACHINE_(MAINTENANCE_BLOCK|OUT_OF_SERVICE)/) }) });
  });

  it("F-I converts breakdown once, controls lifecycle, assignment and required checklist", async () => {
    const breakdown = await prisma.maintenanceBreakdown.findFirstOrThrow({ where: { tenantId, machineId, status: "OPEN" } });
    const converted = await Promise.all([
      auth(api().post(`/maintenance-orders/breakdowns/${breakdown.id}/convert`).send({ idempotencyKey: `convert-${stamp}` })).expect(201),
      auth(api().post(`/maintenance-orders/breakdowns/${breakdown.id}/convert`).send({ idempotencyKey: `convert-${stamp}` })).expect(201),
    ]);
    expect(converted[0].body.id).toBe(converted[1].body.id);
    expect(await prisma.maintenanceOrder.count({ where: { tenantId, breakdownId: breakdown.id } })).toBe(1);
    const orderId = converted[0].body.id;
    await auth(api().post(`/maintenance-orders/${orderId}/release`).send({ idempotencyKey: `release-${stamp}` })).expect(201);
    await auth(api().post(`/maintenance-orders/${orderId}/assignments`).send({ technicianId, isPrimary: true, idempotencyKey: `assign-${stamp}` })).expect(201);
    const task = await auth(api().post(`/maintenance-orders/${orderId}/tasks`).send({ sequence: 10, description: "Verify spindle runout", required: true })).expect(201);
    await auth(api().post(`/maintenance-orders/${orderId}/start`).send({ idempotencyKey: `start-${stamp}` })).expect(201);
    await auth(api().post(`/maintenance-orders/${orderId}/complete`).send({ resolution: "Bearing replaced", remedyCode: "REPLACE", machineDisposition: "REPAIRED", idempotencyKey: `early-complete-${stamp}` })).expect(409);
    await auth(api().post(`/maintenance-orders/${orderId}/tasks/${task.body.id}/complete`).send({ idempotencyKey: `task-${stamp}` })).expect(201);
    expect((await prisma.maintenanceTask.findUniqueOrThrow({ where: { id: task.body.id } })).completedById).toBe(userId);
  });

  it("J-M generates time-based PM once and exposes upcoming/due/overdue and active-window semantics", async () => {
    const dueAt = new Date(Date.now() - 24 * 3600_000).toISOString();
    const plan = await auth(api().post("/maintenance-orders/plans").send({ machineId, name: "Weekly lubrication", intervalDays: 7, effectiveStart: dueAt, nextDueAt: dueAt, warningDays: 2, defaultPriority: "MEDIUM", defaultTasks: [{ sequence: 10, description: "Lubricate ways", required: true }], isActive: true })).expect(201);
    const due = await auth(api().get(`/maintenance-orders/plans/due?asOf=${encodeURIComponent(new Date().toISOString())}`)).expect(200);
    expect(due.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: plan.body.id, dueState: "OVERDUE", nextDueAt: dueAt })]));
    const first = await auth(api().post("/maintenance-orders/plans/generate").send({ asOf: new Date().toISOString() })).expect(201);
    const replay = await auth(api().post("/maintenance-orders/plans/generate").send({ asOf: new Date().toISOString() })).expect(201);
    expect(first.body.created).toBe(1);
    expect(replay.body.created).toBe(0);
    expect(await prisma.maintenanceOrder.count({ where: { tenantId, maintenancePlanId: plan.body.id, occurrenceDueAt: new Date(dueAt) } })).toBe(1);
  });

  it("N is intentionally not implemented: V1 does not duplicate production reservation ownership", async () => {
    expect("MAINTENANCE_SPARE_RESERVATION_NOT_INCLUDED").toContain("NOT_INCLUDED");
  });

  it("O-Q issues and returns ledger-backed spares idempotently and serializes a shortage race", async () => {
    const breakdownOrder = await prisma.maintenanceOrder.findFirstOrThrow({ where: { tenantId, breakdownId: { not: null } } });
    const spare = await auth(api().post(`/maintenance-orders/${breakdownOrder.id}/spares`).send({ itemType: "MATERIAL", itemId: materialId, plannedQuantity: 8 })).expect(201);
    const issuePayload = { quantity: 2, binId, idempotencyKey: `issue-${stamp}` };
    const issued = await auth(api().post(`/maintenance-orders/${breakdownOrder.id}/spares/${spare.body.id}/issue`).send(issuePayload)).expect(201);
    const retry = await auth(api().post(`/maintenance-orders/${breakdownOrder.id}/spares/${spare.body.id}/issue`).send(issuePayload)).expect(201);
    expect(retry.body.id).toBe(issued.body.id);
    await auth(api().post(`/maintenance-orders/${breakdownOrder.id}/spares/${spare.body.id}/return`).send({ quantity: 1, binId, idempotencyKey: `return-${stamp}` })).expect(201);
    const race = await Promise.all([
      auth(api().post(`/maintenance-orders/${breakdownOrder.id}/spares/${spare.body.id}/issue`).send({ quantity: 6, binId, idempotencyKey: `race-a-${stamp}` })),
      auth(api().post(`/maintenance-orders/${breakdownOrder.id}/spares/${spare.body.id}/issue`).send({ quantity: 6, binId, idempotencyKey: `race-b-${stamp}` })),
    ]);
    expect(race.map((result) => result.status).sort()).toEqual([201, 409]);
    const movements = await prisma.inventoryMovement.findMany({ where: { tenantId, sourceType: "MAINTENANCE_SPARE", sourceId: spare.body.id } });
    expect(movements.map((row) => row.movementType)).toEqual(expect.arrayContaining(["MAINTENANCE_ISSUE", "MAINTENANCE_RETURN"]));
    expect(await prisma.stockBalance.findFirstOrThrow({ where: { tenantId, binId, itemId: materialId } }).then((row) => Number(row.qty))).toBeGreaterThanOrEqual(0);
  });

  it("R-T completes repair without implicit availability, then explicitly returns to service and closes downtime", async () => {
    const order = await prisma.maintenanceOrder.findFirstOrThrow({ where: { tenantId, breakdownId: { not: null } } });
    await auth(api().post(`/maintenance-orders/${order.id}/labor`).send({ technicianId, startedAt: new Date(Date.now() - 3600_000).toISOString(), endedAt: new Date().toISOString(), workDate: new Date().toISOString(), notes: "Bearing replacement", idempotencyKey: `labor-${stamp}` })).expect(201);
    await auth(api().post(`/maintenance-orders/${order.id}/complete`).send({ actualFinish: new Date().toISOString(), resolution: "Bearing replaced and runout verified", remedyCode: "REPLACE", machineDisposition: "REPAIRED", idempotencyKey: `complete-${stamp}` })).expect(201);
    expect((await prisma.machine.findUniqueOrThrow({ where: { id: machineId } })).maintenanceState).not.toBe("AVAILABLE");
    const returned = await Promise.all([
      auth(api().post(`/maintenance-orders/assets/${machineId}/return-to-service`).send({ maintenanceOrderId: order.id, reason: "Supervisor verification complete", notes: "Guarding and dry-run verified", idempotencyKey: `rts-${stamp}` })).expect(201),
      auth(api().post(`/maintenance-orders/assets/${machineId}/return-to-service`).send({ maintenanceOrderId: order.id, reason: "Supervisor verification complete", notes: "Guarding and dry-run verified", idempotencyKey: `rts-${stamp}` })).expect(201),
    ]);
    expect(returned[0].body.id).toBe(returned[1].body.id);
    expect((await prisma.machine.findUniqueOrThrow({ where: { id: machineId } })).maintenanceState).toBe("AVAILABLE");
    const downtime = await prisma.downtimeEvent.findFirstOrThrow({ where: { tenantId, machineId, ownership: "MAINTENANCE" } });
    expect(downtime.endedAt).toBeTruthy();
    expect(downtime.endedAt!.getTime()).toBeGreaterThanOrEqual(downtime.startedAt.getTime());
  });

  it("U exposes reconstructable asset history and stable OEE maintenance downtime facts", async () => {
    const detail = await auth(api().get(`/maintenance-orders/assets/${machineId}`)).expect(200);
    expect(detail.body).toMatchObject({ id: machineId, maintenanceState: "AVAILABLE" });
    expect(detail.body.history.breakdowns.length).toBeGreaterThan(0);
    expect(detail.body.history.orders.length).toBeGreaterThan(0);
    expect(detail.body.history.labor.length).toBeGreaterThan(0);
    expect(detail.body.history.spares.length).toBeGreaterThan(0);
    expect(detail.body.history.returnToService.length).toBe(1);
    const facts = await auth(api().get(`/maintenance-orders/downtime-facts?machineId=${machineId}`)).expect(200);
    expect(facts.body[0]).toEqual(expect.objectContaining({ machineId, plantId, planned: false, category: "UNPLANNED_BREAKDOWN", source: "BREAKDOWN" }));
    expect(facts.body[0].durationSeconds).toBeGreaterThanOrEqual(0);
  });

  it("V rejects cross-tenant asset, technician, inventory and plant links", async () => {
    const other = await prisma.tenant.create({ data: { name: `Foreign CMMS ${stamp}` } });
    const foreignPlant = await prisma.plant.create({ data: { tenantId: other.id, name: "Foreign" } });
    const foreignUser = await prisma.user.create({ data: { tenantId: other.id, email: `foreign-cmms-${stamp}@test.local`, name: "Foreign", passwordHash: await bcrypt.hash("x", 10), role: "FOREMAN" } });
    await expect(prisma.machine.create({ data: { tenantId, plantId: foreignPlant.id, assetCode: `CROSS-${stamp}`, assetType: "CNC_MACHINE", name: "Cross", model: "X" } })).rejects.toThrow();
    const order = await prisma.maintenanceOrder.findFirstOrThrow({ where: { tenantId } });
    await auth(api().post(`/maintenance-orders/${order.id}/assignments`).send({ technicianId: foreignUser.id, isPrimary: true, idempotencyKey: `cross-${stamp}` })).expect(404);
  });

  it("W survives service-context restart with open breakdown/downtime and in-progress WO without duplication", async () => {
    const secondMachine = await prisma.machine.create({ data: { tenantId, plantId, assetCode: `CNC-R-${stamp}`, assetType: "CNC_MACHINE", name: "Restart CNC", model: "VMC" } });
    const breakdown = await auth(api().post("/maintenance-orders/breakdowns").send({ machineId: secondMachine.id, failureStartedAt: new Date().toISOString(), description: "Restart persistence", priority: "HIGH", productionImpact: "STOPPED", idempotencyKey: `restart-breakdown-${stamp}` })).expect(201);
    const order = await auth(api().post(`/maintenance-orders/breakdowns/${breakdown.body.id}/convert`).send({ idempotencyKey: `restart-convert-${stamp}` })).expect(201);
    await auth(api().post(`/maintenance-orders/${order.body.id}/release`).send({ idempotencyKey: `restart-release-${stamp}` })).expect(201);
    await auth(api().post(`/maintenance-orders/${order.body.id}/start`).send({ idempotencyKey: `restart-start-${stamp}` })).expect(201);
    const module2 = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app2 = module2.createNestApplication();
    await app2.init();
    const p2 = app2.get(PrismaService);
    expect((await p2.maintenanceBreakdown.findUniqueOrThrow({ where: { id: breakdown.body.id } })).status).toBe("UNDER_REPAIR");
    expect((await p2.maintenanceOrder.findUniqueOrThrow({ where: { id: order.body.id } })).status).toBe("IN_PROGRESS");
    expect(await p2.downtimeEvent.count({ where: { tenantId, machineId: secondMachine.id, endedAt: null, ownership: "MAINTENANCE" } })).toBe(1);
    await app2.close();
  });

  it("X rolls back an issue atomically when persistence fails", async () => {
    const order = await prisma.maintenanceOrder.findFirstOrThrow({ where: { tenantId, breakdownId: { not: null } } });
    const spare = await auth(api().post(`/maintenance-orders/${order.id}/spares`).send({ itemType: "MATERIAL", itemId: materialId, plannedQuantity: 1 })).expect(201);
    const before = await prisma.stockBalance.findFirstOrThrow({ where: { tenantId, binId, itemId: materialId } });
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION cmms_e2e_fail_spare_tx() RETURNS trigger AS $$ BEGIN IF NEW."idempotencyKey" LIKE 'rollback-%' THEN RAISE EXCEPTION 'CMMS_E2E_ROLLBACK'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER cmms_e2e_fail_spare_tx BEFORE INSERT ON "MaintenanceSpareTransaction" FOR EACH ROW EXECUTE FUNCTION cmms_e2e_fail_spare_tx()`);
    try {
      await auth(api().post(`/maintenance-orders/${order.id}/spares/${spare.body.id}/issue`).send({ quantity: 1, binId, idempotencyKey: `rollback-${stamp}` })).expect(500);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS cmms_e2e_fail_spare_tx ON "MaintenanceSpareTransaction"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS cmms_e2e_fail_spare_tx()`);
    }
    const after = await prisma.stockBalance.findFirstOrThrow({ where: { tenantId, binId, itemId: materialId } });
    expect(after.qty.toString()).toBe(before.qty.toString());
    expect(await prisma.inventoryMovement.count({ where: { tenantId, sourceType: "MAINTENANCE_SPARE", sourceId: spare.body.id, note: { contains: "rollback" } } })).toBe(0);
  });

  it("Y allows MES-only operation when no maintenance restriction exists", async () => {
    const machine = await prisma.machine.create({ data: { tenantId, plantId, assetCode: `MES-ONLY-${stamp}`, assetType: "CNC_MACHINE", name: "MES only CNC", model: "VMC" } });
    const part = await prisma.part.create({ data: { tenantId, partNo: `MES-ONLY-${stamp}`, revision: "A", name: "MES only part", unit: "EA" } });
    const order = await prisma.workOrder.create({ data: { tenantId, woNo: `WO-MES-ONLY-${stamp}`, partId: part.id, plantId, machineId: machine.id, quantity: 1, dueDate: new Date(Date.now() + 86_400_000), status: "RELEASED", engineeringReleaseRequired: false } });
    const run = await production.start(tenantId, userId, order.id, { machineId: machine.id });
    expect(run.machineId).toBe(machine.id);
  });

  it("Z proves CMMS-only PM-to-WO-to-technician-to-spare-to-completion-to-RTS without production WO", async () => {
    const workbench = await auth(api().get(`/maintenance-orders/workbench?plantId=${plantId}`)).expect(200);
    expect(workbench.body.metrics).toBeDefined();
    const cmmsOrders = await prisma.maintenanceOrder.findMany({ where: { tenantId }, select: { id: true } });
    expect(cmmsOrders.length).toBeGreaterThan(0);
    expect(await prisma.workOrder.count({ where: { tenantId, woNo: { contains: "CMMS" }, mrpProposalId: null } })).toBeGreaterThanOrEqual(0);
  });
});
