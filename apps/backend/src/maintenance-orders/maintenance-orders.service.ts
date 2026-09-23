import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InventoryMovementType, MaintenanceOrderStatus, Prisma, type PrismaClient } from "@prisma/client";
import type {
  CompleteMaintenanceOrderDto, CreateMaintenanceOrderDto, CreateMaintenanceRequestDto,
  DeclareMaintenanceBreakdownDto, CreateMaintenancePlanDto,
} from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { OutboxService } from "../outbox/outbox.service";
import { NotificationsService } from "../notifications/notifications.service";
import { InventoryService } from "../inventory/inventory.service";
import { nextDocNo } from "../common/numbering";
import { writeTransactionalAudit } from "../common/transactional-audit";

type Tx = Prisma.TransactionClient;
const ACTIVE_RESERVATIONS = ["OPEN", "PARTIALLY_ALLOCATED", "ALLOCATED", "PARTIALLY_ISSUED", "ISSUED"] as const;
const ACTIVE_MAINTENANCE_SPARE_RESERVATIONS = ["OPEN", "PARTIALLY_ISSUED"] as const;
const TRANSITIONS: Record<MaintenanceOrderStatus, MaintenanceOrderStatus[]> = {
  DRAFT: ["PLANNED", "RELEASED", "CANCELLED"], PLANNED: ["RELEASED", "CANCELLED"],
  RELEASED: ["IN_PROGRESS", "CANCELLED"], IN_PROGRESS: ["ON_HOLD", "COMPLETED", "CANCELLED"],
  ON_HOLD: ["IN_PROGRESS", "COMPLETED", "CANCELLED"], COMPLETED: [], CANCELLED: [],
};
const ORDER_INCLUDE = {
  machine: true, request: true, breakdown: true, plan: true,
  technicianAssignments: { include: { technician: { select: { id: true, name: true, email: true } } } },
  tasks: { orderBy: { sequence: "asc" as const }, include: { completedBy: { select: { id: true, name: true } } } },
  laborEntries: { include: { technician: { select: { id: true, name: true } } }, orderBy: { workDate: "desc" as const } },
  spareLines: { include: { transactions: { orderBy: { createdAt: "asc" as const } }, reservations: { orderBy: { createdAt: "asc" as const } } } },
  downtimeEvents: { include: { reason: true }, orderBy: { startedAt: "desc" as const } },
  createdBy: { select: { id: true, name: true } },
} as const;

@Injectable()
export class MaintenanceOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly outbox: OutboxService,
    private readonly inventory?: InventoryService,
  ) {}

  findAll(tenantId: string, machineId?: string, status?: MaintenanceOrderStatus) {
    return this.prisma.maintenanceOrder.findMany({ where: { tenantId, ...(machineId ? { machineId } : {}), ...(status ? { status } : {}) }, include: ORDER_INCLUDE, orderBy: [{ priority: "desc" }, { scheduledDate: "asc" }] });
  }
  async findOne(tenantId: string, id: string) {
    const item = await this.prisma.maintenanceOrder.findFirst({ where: { id, tenantId }, include: ORDER_INCLUDE });
    if (!item) throw new NotFoundException("Maintenance work order was not found");
    return item;
  }
  listAssets(tenantId: string, plantId?: string) {
    return this.prisma.machine.findMany({ where: { tenantId, ...(plantId ? { plantId } : {}) }, include: { unit: { include: { workplace: { include: { area: { include: { plant: true } } } } } } }, orderBy: { name: "asc" } });
  }
  async assetDetail(tenantId: string, machineId: string) {
    const machine = await this.prisma.machine.findFirst({ where: { id: machineId, tenantId } });
    if (!machine) throw new NotFoundException("Maintainable asset was not found");
    const [history, reliability] = await Promise.all([this.history(tenantId, machineId), this.reliability(tenantId, machineId)]);
    return { ...machine, history, reliability };
  }
  /**
   * Evidence-based reliability projection. MTTR uses completed corrective
   * work actuals; failure spacing is deliberately named calendar MTBF because
   * controller/runtime uptime is not yet a qualified universal source.
   */
  async reliability(tenantId: string, machineId?: string, from?: Date, to?: Date) {
    const failures = await this.prisma.maintenanceBreakdown.findMany({
      where: { tenantId, status: "RESOLVED", ...(machineId ? { machineId } : {}), ...(from || to ? { failureStartedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
      include: { machine: { select: { id: true, name: true, plantId: true } }, maintenanceOrder: { select: { id: true, status: true, actualStart: true, actualFinish: true } } }, orderBy: [{ machineId: "asc" }, { failureStartedAt: "asc" }],
    });
    const groups = new Map<string, typeof failures>(); for (const failure of failures) groups.set(failure.machineId, [...(groups.get(failure.machineId) ?? []), failure]);
    const machines = [...groups.values()].map((items) => {
      const repairs = items.flatMap((item) => item.maintenanceOrder?.status === "COMPLETED" && item.maintenanceOrder.actualStart && item.maintenanceOrder.actualFinish && item.maintenanceOrder.actualFinish >= item.maintenanceOrder.actualStart ? [(item.maintenanceOrder.actualFinish.getTime() - item.maintenanceOrder.actualStart.getTime()) / 3_600_000] : []);
      const intervals = items.slice(1).map((item, index) => (item.failureStartedAt.getTime() - items[index].failureStartedAt.getTime()) / 3_600_000).filter((hours) => hours >= 0);
      const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
      return { machineId: items[0].machineId, machineName: items[0].machine.name, plantId: items[0].machine.plantId, failureCount: items.length, repairSampleCount: repairs.length, mttrHours: mean(repairs), failureIntervalSampleCount: intervals.length, mtbfCalendarHours: mean(intervals), firstFailureAt: items[0].failureStartedAt, lastFailureAt: items.at(-1)?.failureStartedAt };
    });
    const mttrValues = machines.flatMap((item) => item.mttrHours === null ? [] : [item.mttrHours]); const mtbfValues = machines.flatMap((item) => item.mtbfCalendarHours === null ? [] : [item.mtbfCalendarHours]); const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    return { definition: { mttr: "Completed corrective work actualStart-to-actualFinish mean", mtbfCalendar: "Mean calendar interval between resolved failure start timestamps; not machine runtime uptime" }, machines, totals: { resolvedFailureCount: failures.length, machines: machines.length, meanMachineMttrHours: mean(mttrValues), meanMachineMtbfCalendarHours: mean(mtbfValues) } };
  }
  async history(tenantId: string, machineId: string) {
    await this.machine(this.prisma, tenantId, machineId);
    const [requests, breakdowns, orders, downtime, stateEvents, returnToService, labor, spares] = await Promise.all([
      this.prisma.maintenanceRequest.findMany({ where: { tenantId, machineId }, orderBy: { reportedAt: "desc" } }),
      this.prisma.maintenanceBreakdown.findMany({ where: { tenantId, machineId }, orderBy: { failureStartedAt: "desc" } }),
      this.prisma.maintenanceOrder.findMany({ where: { tenantId, machineId }, include: ORDER_INCLUDE, orderBy: { createdAt: "desc" } }),
      this.prisma.downtimeEvent.findMany({ where: { tenantId, machineId, ownership: "MAINTENANCE" }, orderBy: { startedAt: "desc" } }),
      this.prisma.machineMaintenanceStateEvent.findMany({ where: { tenantId, machineId }, orderBy: { occurredAt: "desc" } }),
      this.prisma.returnToServiceEvent.findMany({ where: { tenantId, machineId }, orderBy: { returnedAt: "desc" } }),
      this.prisma.maintenanceLaborEntry.findMany({ where: { tenantId, maintenanceOrder: { machineId } }, include: { technician: { select: { id: true, name: true } } }, orderBy: { workDate: "desc" } }),
      this.prisma.maintenanceSpareLine.findMany({ where: { tenantId, maintenanceOrder: { machineId } }, include: { transactions: { orderBy: { createdAt: "desc" } }, reservations: { orderBy: { createdAt: "desc" } } }, orderBy: { createdAt: "desc" } }),
    ]);
    return { requests, breakdowns, orders, downtime, stateEvents, returnToService, labor, spares };
  }
  async workbench(tenantId: string, filters: any = {}) {
    const orderWhere: any = { tenantId, ...(filters.plantId ? { plantId: filters.plantId } : {}), ...(filters.machineId ? { machineId: filters.machineId } : {}), ...(filters.status ? { status: filters.status } : {}), ...(filters.priority ? { priority: filters.priority } : {}), ...(filters.type ? { type: filters.type } : {}), ...(filters.technicianId ? { technicianAssignments: { some: { technicianId: filters.technicianId } } } : {}) };
    const now = new Date();
    const [requests, breakdowns, orders, pmDue, assetsOutOfService, activeDowntime] = await Promise.all([
      this.prisma.maintenanceRequest.findMany({ where: { tenantId, status: "OPEN", ...(filters.plantId ? { plantId: filters.plantId } : {}) }, include: { machine: true }, orderBy: { reportedAt: "desc" } }),
      this.prisma.maintenanceBreakdown.findMany({ where: { tenantId, status: { in: ["OPEN", "UNDER_REPAIR"] }, ...(filters.plantId ? { plantId: filters.plantId } : {}) }, include: { machine: true, maintenanceOrder: true }, orderBy: { failureStartedAt: "desc" } }),
      this.prisma.maintenanceOrder.findMany({ where: { ...orderWhere, status: { notIn: ["COMPLETED", "CANCELLED"] } }, include: ORDER_INCLUDE, orderBy: [{ priority: "desc" }, { scheduledDate: "asc" }] }),
      this.duePlans(tenantId, now),
      this.prisma.machine.findMany({ where: { tenantId, maintenanceState: { in: ["BREAKDOWN", "OUT_OF_SERVICE", "PLANNED_MAINTENANCE"] }, ...(filters.plantId ? { plantId: filters.plantId } : {}) }, orderBy: { name: "asc" } }),
      this.prisma.downtimeEvent.findMany({ where: { tenantId, ownership: "MAINTENANCE", endedAt: null }, include: { machine: true }, orderBy: { startedAt: "asc" } }),
    ]);
    return { metrics: { openRequests: requests.length, activeBreakdowns: breakdowns.length, openOrders: orders.length, pmDue: pmDue.filter((x: any) => x.dueState === "DUE").length, pmOverdue: pmDue.filter((x: any) => x.dueState === "OVERDUE").length, machinesOutOfService: assetsOutOfService.length, activeDowntime: activeDowntime.length }, requests, breakdowns, orders, pmDue, assetsOutOfService, activeDowntime };
  }

  async createRequest(tenantId: string, userId: string, dto: CreateMaintenanceRequestDto) {
    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.maintenanceRequest.findFirst({ where: { tenantId, idempotencyKey: dto.idempotencyKey } }); if (previous) return previous;
      const machine = await this.machine(tx, tenantId, dto.machineId); if (!machine.plantId) throw new ConflictException("ASSET_PLANT_REQUIRED");
      const item = await tx.maintenanceRequest.create({ data: { tenantId, plantId: machine.plantId, machineId: machine.id, problem: dto.problem, priority: dto.priority, description: dto.description, reportedAt: dto.reportedAt ? new Date(dto.reportedAt) : undefined, reportedById: userId, productionWorkOrderId: dto.productionWorkOrderId, documentId: dto.documentId, idempotencyKey: dto.idempotencyKey } });
      await this.audit(tx, tenantId, userId, "maintenance-request", item.id, "CREATE", null, item); await this.outbox.record(tx, tenantId, "maintenance-request", item.id, "maintenance.updated", { id: item.id }); return item;
    });
  }

  async declareBreakdown(tenantId: string, userId: string, dto: DeclareMaintenanceBreakdownDto) {
    return this.prisma.$transaction(async (tx) => {
      const prior = await tx.maintenanceBreakdown.findFirst({ where: { tenantId, idempotencyKey: dto.idempotencyKey }, include: { downtimeEvents: true } }); if (prior) return prior;
      await tx.$queryRaw`SELECT "id" FROM "Machine" WHERE "id"=${dto.machineId} AND "tenantId"=${tenantId} FOR UPDATE`;
      const afterLock = await tx.maintenanceBreakdown.findFirst({ where: { tenantId, idempotencyKey: dto.idempotencyKey }, include: { downtimeEvents: true } }); if (afterLock) return afterLock;
      const machine = await this.machine(tx, tenantId, dto.machineId); if (!machine.plantId) throw new ConflictException("ASSET_PLANT_REQUIRED");
      const open = await tx.maintenanceBreakdown.findFirst({ where: { tenantId, machineId: machine.id, status: { in: ["OPEN", "UNDER_REPAIR"] } } }); if (open) throw new ConflictException("MACHINE_ALREADY_HAS_OPEN_BREAKDOWN");
      const item = await tx.maintenanceBreakdown.create({ data: { tenantId, plantId: machine.plantId, machineId: machine.id, requestId: dto.requestId, failureStartedAt: new Date(dto.failureStartedAt), detectedById: userId, failureCodeId: dto.failureCodeId, description: dto.description, priority: dto.priority, productionImpact: dto.productionImpact, idempotencyKey: dto.idempotencyKey } });
      const downtime = await tx.downtimeEvent.create({ data: { tenantId, machineId: machine.id, workOrderId: machine.activeWorkOrderId, source: "MAINTENANCE", ownership: "MAINTENANCE", maintenanceCategory: "UNPLANNED_BREAKDOWN", maintenanceBreakdownId: item.id, note: dto.description, startedAt: new Date(dto.failureStartedAt), triggeredById: userId } });
      await this.changeMachineState(tx, tenantId, userId, machine, "BREAKDOWN", "Breakdown declared", undefined, item.id);
      await this.audit(tx, tenantId, userId, "maintenance-breakdown", item.id, "CREATE", null, item); await this.outbox.record(tx, tenantId, "maintenance-breakdown", item.id, "maintenance.updated", { id: item.id, downtimeId: downtime.id }); return { ...item, downtimeEvents: [downtime] };
    });
  }

  async convertBreakdown(tenantId: string, userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "MaintenanceBreakdown" WHERE "id"=${id} AND "tenantId"=${tenantId} FOR UPDATE`;
      const breakdown = await tx.maintenanceBreakdown.findFirst({ where: { id, tenantId } }); if (!breakdown) throw new NotFoundException("Breakdown was not found");
      const existing = await tx.maintenanceOrder.findFirst({ where: { tenantId, breakdownId: id }, include: ORDER_INCLUDE }); if (existing) return existing;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('cmms-maintenance-order-number'))`;
      const bakNo = await nextDocNo(tx, "maintenanceOrder", "bakNo", "BAK");
      const order = await tx.maintenanceOrder.create({ data: { tenantId, plantId: breakdown.plantId, bakNo, machineId: breakdown.machineId, breakdownId: id, requestId: breakdown.requestId, type: "CORRECTIVE", priority: breakdown.priority, status: "DRAFT", description: breakdown.description, createdById: userId }, include: ORDER_INCLUDE });
      await tx.maintenanceBreakdown.update({ where: { id }, data: { status: "UNDER_REPAIR" } }); await this.audit(tx, tenantId, userId, "maintenance-order", order.id, "CREATE", null, order); return order;
    });
  }

  async create(tenantId: string, userId: string, dto: CreateMaintenanceOrderDto) { return this.createOrder(tenantId, userId, dto); }
  async createOrder(tenantId: string, userId: string, dto: CreateMaintenanceOrderDto) {
    return this.prisma.$transaction(async (tx) => {
      if (dto.idempotencyKey) { const prior = await tx.maintenanceOrder.findFirst({ where: { tenantId, idempotencyKey: dto.idempotencyKey }, include: ORDER_INCLUDE }); if (prior) return prior; }
      const machine = await this.machine(tx, tenantId, dto.machineId); if (!machine.plantId) throw new ConflictException("ASSET_PLANT_REQUIRED"); await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('cmms-maintenance-order-number'))`;
      const bakNo = await nextDocNo(tx, "maintenanceOrder", "bakNo", "BAK");
      const item = await tx.maintenanceOrder.create({ data: { tenantId, plantId: machine.plantId, bakNo, machineId: machine.id, type: dto.type, priority: dto.priority, scheduledDate: dto.scheduledDate ? new Date(dto.scheduledDate) : undefined, description: dto.description, plannedStart: dto.plannedStart ? new Date(dto.plannedStart) : undefined, plannedFinish: dto.plannedFinish ? new Date(dto.plannedFinish) : undefined, blockingFrom: dto.blockingFrom ? new Date(dto.blockingFrom) : undefined, blockingUntil: dto.blockingUntil ? new Date(dto.blockingUntil) : undefined, notes: dto.notes, idempotencyKey: dto.idempotencyKey, createdById: userId }, include: ORDER_INCLUDE });
      await this.audit(tx, tenantId, userId, "maintenance-order", item.id, "CREATE", null, item); await this.outbox.record(tx, tenantId, "maintenanceorder", item.id, "maintenanceorder.updated", { id: item.id }); return item;
    });
  }

  async setStatus(tenantId: string, id: string, status: MaintenanceOrderStatus) { const item = await this.findOne(tenantId, id); return this.transition(tenantId, item.createdById, id, status, { idempotencyKey: `legacy:${id}:${status}` }); }
  async transition(tenantId: string, userId: string, id: string, to: MaintenanceOrderStatus, dto: { note?: string; idempotencyKey: string }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "MaintenanceOrder" WHERE "id"=${id} AND "tenantId"=${tenantId} FOR UPDATE`;
      const item = await tx.maintenanceOrder.findFirst({ where: { id, tenantId } }); if (!item) throw new NotFoundException("Maintenance work order was not found");
      if (!TRANSITIONS[item.status].includes(to)) throw new ConflictException(`INVALID_MAINTENANCE_TRANSITION:${item.status}->${to}`);
      if (to === "CANCELLED" && await tx.maintenanceSpareReservation.count({ where: { tenantId, spareLine: { maintenanceOrderId: id }, status: { in: ACTIVE_MAINTENANCE_SPARE_RESERVATIONS as any } } })) throw new ConflictException("ACTIVE_SPARE_RESERVATIONS_MUST_BE_CANCELLED");
      const updated = await tx.maintenanceOrder.update({ where: { id }, data: { status: to, ...(to === "IN_PROGRESS" && !item.actualStart ? { actualStart: new Date() } : {}), ...(dto.note ? { notes: dto.note } : {}) }, include: ORDER_INCLUDE });
      await this.audit(tx, tenantId, userId, "maintenance-order", id, "STATUS_CHANGE", { status: item.status }, { status: to }); await this.outbox.record(tx, tenantId, "maintenanceorder", id, "maintenanceorder.updated", { id, status: to }); return updated;
    });
  }

  async createPlan(tenantId: string, userId: string, dto: CreateMaintenancePlanDto) {
    const machine = await this.machine(this.prisma, tenantId, dto.machineId); if (!machine.plantId) throw new ConflictException("ASSET_PLANT_REQUIRED");
    return this.prisma.$transaction(async (tx) => { const plan = await tx.maintenancePlan.create({ data: { tenantId, plantId: machine.plantId!, machineId: machine.id, name: dto.name, frequencyDays: dto.frequency ?? dto.frequencyDays ?? (dto as any).intervalDays!, active: (dto as any).isActive ?? true, effectiveStart: new Date(dto.effectiveStart), nextDueAt: new Date(dto.nextDueAt), warningDays: dto.warningDays, defaultPriority: dto.defaultPriority, defaultDescription: dto.defaultDescription, defaultTasks: dto.defaultTasks, createdById: userId } }); await this.audit(tx, tenantId, userId, "maintenance-plan", plan.id, "CREATE", null, plan); return plan; });
  }
  async duePlans(tenantId: string, asOf = new Date()) {
    const plans = await this.prisma.maintenancePlan.findMany({ where: { tenantId, active: true, nextDueAt: { lte: new Date(asOf.getTime() + 365 * 86400000) } }, include: { machine: true }, orderBy: { nextDueAt: "asc" } });
    return plans.map((p) => ({ ...p, dueState: p.nextDueAt.getTime() < asOf.getTime() ? "OVERDUE" : p.nextDueAt.getTime() <= asOf.getTime() + p.warningDays * 86400000 ? "DUE" : "UPCOMING" }));
  }
  async generateDue(tenantId: string, userId: string, asOf = new Date()) {
    const due = (await this.duePlans(tenantId, asOf)).filter((p) => p.dueState !== "UPCOMING"); const results: Array<{ order: any; created: boolean }> = [];
    for (const plan of due) results.push(await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "MaintenancePlan" WHERE "id"=${plan.id} AND "tenantId"=${tenantId} FOR UPDATE`;
      const existing = await tx.maintenanceOrder.findFirst({ where: { maintenancePlanId: plan.id, occurrenceDueAt: plan.nextDueAt }, include: ORDER_INCLUDE }); if (existing) return { order: existing, created: false };
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('cmms-maintenance-order-number'))`; const bakNo = await nextDocNo(tx, "maintenanceOrder", "bakNo", "BAK");
      let order = await tx.maintenanceOrder.create({ data: { tenantId, plantId: plan.plantId, bakNo, machineId: plan.machineId, maintenancePlanId: plan.id, occurrenceDueAt: plan.nextDueAt, type: "PREVENTIVE", priority: plan.defaultPriority, status: "PLANNED", description: plan.defaultDescription, scheduledDate: plan.nextDueAt, createdById: userId }, include: ORDER_INCLUDE });
      const planTasks = (plan.defaultTasks as any[]) ?? [];
      if (planTasks.length) {
        await tx.maintenanceTask.createMany({ data: planTasks.map((t) => ({ tenantId, maintenanceOrderId: order.id, sequence: t.sequence, description: t.description, required: Boolean(t.required) })) });
        order = await tx.maintenanceOrder.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_INCLUDE });
      }
      await tx.maintenancePlan.update({ where: { id: plan.id }, data: { nextDueAt: new Date(plan.nextDueAt.getTime() + plan.frequencyDays * 86400000) } }); return { order, created: true };
    })); return { due: due.length, created: results.filter((result) => result.created).length, orders: results.map((result) => result.order) };
  }

  assignTechnician(tenantId: string, userId: string, id: string, dto: { technicianId: string; isPrimary?: boolean }) { return this.prisma.$transaction(async (tx) => this.assignTechnicianTx(tx, tenantId, userId, id, dto)); }
  private async assignTechnicianTx(tx: Tx, tenantId: string, userId: string, id: string, dto: { technicianId: string; isPrimary?: boolean }) { await this.order(tx, tenantId, id); if (!await tx.user.findFirst({ where: { id: dto.technicianId, tenantId, isActive: true } })) throw new NotFoundException("Technician was not found"); const assignment = await tx.maintenanceTechnicianAssignment.upsert({ where: { tenantId_maintenanceOrderId_technicianId: { tenantId, maintenanceOrderId: id, technicianId: dto.technicianId } }, update: { isPrimary: dto.isPrimary ?? false, assignedById: userId }, create: { tenantId, maintenanceOrderId: id, technicianId: dto.technicianId, isPrimary: dto.isPrimary ?? false, assignedById: userId } }); await this.audit(tx, tenantId, userId, "maintenance-technician-assignment", assignment.id, "CREATE", null, assignment); return assignment; }
  async addTask(tenantId: string, userId: string, id: string, dto: { sequence: number; description: string; required?: boolean }) { await this.findOne(tenantId, id); return this.prisma.maintenanceTask.create({ data: { tenantId, maintenanceOrderId: id, sequence: dto.sequence, description: dto.description, required: dto.required ?? false } }); }
  async completeTask(tenantId: string, userId: string, id: string, taskId: string, completed = true) { await this.findOne(tenantId, id); const result = await this.prisma.maintenanceTask.updateMany({ where: { id: taskId, tenantId, maintenanceOrderId: id }, data: { completed, completedById: completed ? userId : null, completedAt: completed ? new Date() : null } }); if (!result.count) throw new NotFoundException("Maintenance task was not found"); return this.prisma.maintenanceTask.findUniqueOrThrow({ where: { id: taskId } }); }
  async addLabor(tenantId: string, _userId: string, id: string, dto: any) { await this.findOne(tenantId, id); const start = dto.startedAt ? new Date(dto.startedAt) : undefined, end = dto.endedAt ? new Date(dto.endedAt) : undefined; if (start && end && end <= start) throw new ConflictException("LABOR_END_MUST_FOLLOW_START"); const minutes = dto.durationMinutes ?? (start && end ? Math.round((end.getTime() - start.getTime()) / 60000) : 0); if (minutes <= 0) throw new ConflictException("POSITIVE_LABOR_DURATION_REQUIRED"); return this.prisma.maintenanceLaborEntry.upsert({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: dto.idempotencyKey } }, update: {}, create: { tenantId, maintenanceOrderId: id, technicianId: dto.technicianId, workDate: new Date(dto.workDate), startedAt: start, endedAt: end, durationMinutes: minutes, category: dto.category, notes: dto.notes, idempotencyKey: dto.idempotencyKey } }); }
  async addSpare(tenantId: string, _userId: string, id: string, dto: any) { await this.findOne(tenantId, id); return this.prisma.maintenanceSpareLine.create({ data: { tenantId, maintenanceOrderId: id, itemType: dto.itemType, itemId: dto.itemId, plannedQuantity: dto.plannedQuantity } }); }
  async reserveSpare(tenantId: string, userId: string, id: string, lineId: string, dto: any) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.maintenanceSpareReservation.findFirst({ where: { tenantId, idempotencyKey: dto.idempotencyKey } }); if (existing) return existing;
      await tx.$queryRaw`SELECT "id" FROM "MaintenanceOrder" WHERE "id"=${id} AND "tenantId"=${tenantId} FOR UPDATE`;
      const order = await this.order(tx, tenantId, id); if (["COMPLETED", "CANCELLED"].includes(order.status)) throw new ConflictException("MAINTENANCE_ORDER_NOT_RESERVABLE");
      const line = await tx.maintenanceSpareLine.findFirst({ where: { id: lineId, tenantId, maintenanceOrderId: id } }); if (!line) throw new NotFoundException("Maintenance spare line was not found");
      const qty = new Prisma.Decimal(dto.quantity);
      await tx.$queryRaw`SELECT "id" FROM "StockBalance" WHERE "tenantId"=${tenantId} AND "binId"=${dto.binId} AND "itemType"=${line.itemType}::"StockItemType" AND "itemId"=${line.itemId} AND "lotId" IS NOT DISTINCT FROM ${dto.lotId ?? null} FOR UPDATE`;
      const balance = await tx.stockBalance.findFirst({ where: { tenantId, binId: dto.binId, itemType: line.itemType, itemId: line.itemId, lotId: dto.lotId ?? null } }); if (!balance) throw new ConflictException("Selected stock balance was not found");
      if (dto.lotId && await tx.qualityHold.findFirst({ where: { tenantId, lotId: dto.lotId, status: "ACTIVE" } })) throw new ConflictException("INVENTORY_LOT_QUALITY_HELD");
      const [production, maintenance] = await Promise.all([
        tx.productionMaterialReservation.findMany({ where: { tenantId, binId: dto.binId, lotId: dto.lotId ?? null, status: { in: ACTIVE_RESERVATIONS as any }, requirement: { itemType: line.itemType, itemId: line.itemId } }, select: { quantity: true, issuedQty: true } }),
        tx.maintenanceSpareReservation.findMany({ where: { tenantId, binId: dto.binId, lotId: dto.lotId ?? null, status: { in: ACTIVE_MAINTENANCE_SPARE_RESERVATIONS as any }, spareLine: { itemType: line.itemType, itemId: line.itemId } }, select: { quantity: true, issuedQty: true } }),
      ]);
      const allocated = [...production, ...maintenance].reduce((sum, row) => sum.plus(row.quantity).minus(row.issuedQty), new Prisma.Decimal(0));
      const remainingPlan = new Prisma.Decimal(line.plannedQuantity).minus(line.reservedQty).minus(line.issuedQty);
      if (qty.gt(remainingPlan) || qty.gt(new Prisma.Decimal(balance.qty).minus(allocated))) throw new ConflictException("INSUFFICIENT_AVAILABLE_SPARE_STOCK_OR_PLAN_ALREADY_ALLOCATED");
      const reservation = await tx.maintenanceSpareReservation.create({ data: { tenantId, spareLineId: line.id, binId: dto.binId, lotId: dto.lotId, quantity: qty, idempotencyKey: dto.idempotencyKey, createdById: userId } });
      await tx.maintenanceSpareLine.update({ where: { id: line.id }, data: { reservedQty: { increment: qty } } });
      await this.audit(tx, tenantId, userId, "maintenance-spare-reservation", reservation.id, "CREATE", null, { ...reservation, maintenanceOrderId: id }); await this.outbox.record(tx, tenantId, "maintenanceorder", id, "maintenanceorder.updated", { id, spareLineId: line.id }); return reservation;
    });
  }
  async cancelSpareReservation(tenantId: string, userId: string, id: string, lineId: string, reservationId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "MaintenanceOrder" WHERE "id"=${id} AND "tenantId"=${tenantId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "MaintenanceSpareReservation" WHERE "id"=${reservationId} AND "tenantId"=${tenantId} FOR UPDATE`;
      const reservation = await tx.maintenanceSpareReservation.findFirst({ where: { id: reservationId, tenantId, spareLineId: lineId, spareLine: { maintenanceOrderId: id } } }); if (!reservation) throw new NotFoundException("Maintenance spare reservation was not found");
      if (reservation.status === "CANCELLED") return reservation;
      if (new Prisma.Decimal(reservation.issuedQty).gt(0)) throw new ConflictException("ISSUED_SPARE_RESERVATION_CANNOT_BE_CANCELLED");
      const cancelled = await tx.maintenanceSpareReservation.update({ where: { id: reservation.id }, data: { status: "CANCELLED" } }); await tx.maintenanceSpareLine.update({ where: { id: lineId }, data: { reservedQty: { decrement: reservation.quantity } } });
      await this.audit(tx, tenantId, userId, "maintenance-spare-reservation", reservation.id, "STATUS_CHANGE", { status: reservation.status }, { status: "CANCELLED" }); await this.outbox.record(tx, tenantId, "maintenanceorder", id, "maintenanceorder.updated", { id, spareLineId: lineId }); return cancelled;
    });
  }
  issueSpare(tenantId: string, userId: string, id: string, lineId: string, dto: any) { return this.spareMovement("ISSUE", tenantId, userId, id, lineId, dto); }
  returnSpare(tenantId: string, userId: string, id: string, lineId: string, dto: any) { return this.spareMovement("RETURN", tenantId, userId, id, lineId, dto); }
  private async spareMovement(type: "ISSUE" | "RETURN", tenantId: string, userId: string, id: string, lineId: string, dto: any) {
    const inventory = this.inventory;
    if (!inventory) throw new ConflictException("INVENTORY_SERVICE_UNAVAILABLE"); return this.prisma.$transaction(async (tx) => {
      const prior = await tx.maintenanceSpareTransaction.findFirst({ where: { tenantId, idempotencyKey: dto.idempotencyKey } }); if (prior) return prior;
      await tx.$queryRaw`SELECT "id" FROM "MaintenanceOrder" WHERE "id"=${id} AND "tenantId"=${tenantId} FOR UPDATE`;
      const order = await this.order(tx, tenantId, id); if (type === "ISSUE" && ["COMPLETED", "CANCELLED"].includes(order.status)) throw new ConflictException("MAINTENANCE_ORDER_NOT_EXECUTING"); const line = await tx.maintenanceSpareLine.findFirst({ where: { id: lineId, tenantId, maintenanceOrderId: id } }); if (!line) throw new NotFoundException("Maintenance spare line was not found"); const qty = new Prisma.Decimal(dto.quantity);
      await tx.$queryRaw`SELECT "id" FROM "StockBalance" WHERE "tenantId"=${tenantId} AND "binId"=${dto.binId} AND "itemType"=${line.itemType}::"StockItemType" AND "itemId"=${line.itemId} AND "lotId" IS NOT DISTINCT FROM ${dto.lotId ?? null} FOR UPDATE`;
      let reservation: any = null;
      if (type === "ISSUE") {
        if (dto.lotId && await tx.qualityHold.findFirst({ where: { tenantId, lotId: dto.lotId, status: "ACTIVE" } })) throw new ConflictException("INVENTORY_LOT_QUALITY_HELD");
        const balance = await tx.stockBalance.findFirst({ where: { tenantId, binId: dto.binId, itemType: line.itemType, itemId: line.itemId, lotId: dto.lotId ?? null } });
        if (dto.reservationId) { await tx.$queryRaw`SELECT "id" FROM "MaintenanceSpareReservation" WHERE "id"=${dto.reservationId} AND "tenantId"=${tenantId} FOR UPDATE`; reservation = await tx.maintenanceSpareReservation.findFirst({ where: { id: dto.reservationId, tenantId, spareLineId: line.id, binId: dto.binId, lotId: dto.lotId ?? null, status: { in: ACTIVE_MAINTENANCE_SPARE_RESERVATIONS as any } } }); if (!reservation || qty.gt(new Prisma.Decimal(reservation.quantity).minus(reservation.issuedQty))) throw new ConflictException("ISSUE_EXCEEDS_ACTIVE_SPARE_RESERVATION"); }
        else {
          const [production, maintenance] = await Promise.all([
            tx.productionMaterialReservation.findMany({ where: { tenantId, binId: dto.binId, lotId: dto.lotId ?? null, status: { in: ACTIVE_RESERVATIONS as any }, requirement: { itemType: line.itemType, itemId: line.itemId } }, select: { quantity: true, issuedQty: true } }),
            tx.maintenanceSpareReservation.findMany({ where: { tenantId, binId: dto.binId, lotId: dto.lotId ?? null, status: { in: ACTIVE_MAINTENANCE_SPARE_RESERVATIONS as any }, spareLine: { itemType: line.itemType, itemId: line.itemId } }, select: { quantity: true, issuedQty: true } }),
          ]);
          const allocated = [...production, ...maintenance].reduce((sum, row) => sum.plus(row.quantity).minus(row.issuedQty), new Prisma.Decimal(0)); if (!balance || new Prisma.Decimal(balance.qty).minus(allocated).lt(qty)) throw new ConflictException("INSUFFICIENT_AVAILABLE_SPARE_STOCK");
        }
      }
      else if (new Prisma.Decimal(line.issuedQty).minus(line.returnedQty).lt(qty)) throw new ConflictException("SPARE_RETURN_EXCEEDS_NET_ISSUE");
      const movement = await inventory.record(tx, { tenantId, itemType: line.itemType, itemId: line.itemId, quantityDelta: type === "ISSUE" ? -Number(qty) : Number(qty), movementType: type === "ISSUE" ? InventoryMovementType.MAINTENANCE_ISSUE : InventoryMovementType.MAINTENANCE_RETURN, sourceType: "MAINTENANCE_SPARE", sourceId: line.id, sourceLineId: reservation?.id ?? line.id, binId: dto.binId, lotId: dto.lotId, createdById: userId, note: dto.note });
      const event = await tx.maintenanceSpareTransaction.create({ data: { tenantId, spareLineId: line.id, type, quantity: qty, binId: dto.binId, lotId: dto.lotId, idempotencyKey: dto.idempotencyKey, createdById: userId } });
      if (reservation) await tx.maintenanceSpareReservation.update({ where: { id: reservation.id }, data: { issuedQty: { increment: qty }, status: new Prisma.Decimal(reservation.issuedQty).plus(qty).gte(reservation.quantity) ? "ISSUED" : "PARTIALLY_ISSUED" } });
      await tx.maintenanceSpareLine.update({ where: { id: line.id }, data: type === "ISSUE" ? { issuedQty: { increment: qty }, ...(reservation ? { reservedQty: { decrement: qty } } : {}) } : { returnedQty: { increment: qty } } }); await this.audit(tx, tenantId, userId, "maintenance-spare", event.id, "CREATE", null, { event, movementId: movement.id, reservationId: reservation?.id }); return event;
    });
  }

  async complete(tenantId: string, userIdOrId: string, idOrDto: string | CompleteMaintenanceOrderDto, maybeDto?: CompleteMaintenanceOrderDto) {
    const id = typeof idOrDto === "string" ? idOrDto : userIdOrId; const dto = (typeof idOrDto === "string" ? maybeDto : idOrDto) ?? {}; let userId = typeof idOrDto === "string" ? userIdOrId : "";
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "MaintenanceOrder" WHERE "id"=${id} AND "tenantId"=${tenantId} FOR UPDATE`;
      const item = await tx.maintenanceOrder.findFirst({ where: { id, tenantId }, include: { tasks: true, breakdown: true } }); if (!item) throw new NotFoundException("Maintenance work order was not found"); if (!userId) userId = item.createdById;
      if (!["IN_PROGRESS", "ON_HOLD"].includes(item.status)) throw new ConflictException("MAINTENANCE_ORDER_NOT_EXECUTING"); if (item.tasks.some((t) => t.required && !t.completed)) throw new ConflictException("REQUIRED_MAINTENANCE_TASKS_INCOMPLETE");
      if (item.breakdown && (!(dto as any).resolution || (!(dto as any).remedy && !(dto as any).remedyCode) || !(dto as any).machineDisposition)) throw new ConflictException("BREAKDOWN_CLOSURE_DATA_REQUIRED"); const now = new Date();
      const updated = await tx.maintenanceOrder.update({ where: { id }, data: { status: "COMPLETED", completedAt: now, actualFinish: now, completionNotes: (dto as any).completionNotes ?? dto.notes, resolution: (dto as any).resolution, remedy: (dto as any).remedy ?? (dto as any).remedyCode, machineDisposition: (dto as any).machineDisposition }, include: ORDER_INCLUDE });
      if (item.runtimeTriggerHours != null) { await tx.$queryRaw`SELECT "id" FROM "Machine" WHERE "id"=${item.machineId} AND "tenantId"=${tenantId} FOR UPDATE`; const machine = await this.machine(tx, tenantId, item.machineId); if (new Prisma.Decimal(machine.runtimeHours).gt(machine.lastPmRuntimeHours)) await tx.machine.update({ where: { id: machine.id }, data: { lastPmRuntimeHours: machine.runtimeHours } }); }
      if (item.breakdown) { await tx.maintenanceBreakdown.update({ where: { id: item.breakdown.id }, data: { status: "RESOLVED" } }); const machine = await this.machine(tx, tenantId, item.machineId); await this.changeMachineState(tx, tenantId, userId, machine, "OUT_OF_SERVICE", "Repair completed; explicit return to service required", id, item.breakdown.id); }
      await this.audit(tx, tenantId, userId, "maintenance-order", id, "STATUS_CHANGE", { status: item.status }, { status: "COMPLETED" }); return updated;
    });
  }

  async returnToService(tenantId: string, userId: string, machineId: string, dto: any) {
    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.returnToServiceEvent.findFirst({ where: { tenantId, idempotencyKey: dto.idempotencyKey } }); if (previous) return previous; await tx.$queryRaw`SELECT "id" FROM "Machine" WHERE "id"=${machineId} AND "tenantId"=${tenantId} FOR UPDATE`;
      const afterLock = await tx.returnToServiceEvent.findFirst({ where: { tenantId, idempotencyKey: dto.idempotencyKey } }); if (afterLock) return afterLock;
      const machine = await this.machine(tx, tenantId, machineId); if (machine.maintenanceState === "AVAILABLE") throw new ConflictException("MACHINE_ALREADY_AVAILABLE");
      if (dto.maintenanceOrderId) { const order = await tx.maintenanceOrder.findFirst({ where: { id: dto.maintenanceOrderId, tenantId, machineId, status: "COMPLETED" } }); if (!order) throw new ConflictException("COMPLETED_MAINTENANCE_ORDER_REQUIRED"); }
      const event = await tx.returnToServiceEvent.create({ data: { tenantId, machineId, maintenanceOrderId: dto.maintenanceOrderId, breakdownId: dto.breakdownId, actorId: userId, reason: dto.reason, notes: dto.notes, idempotencyKey: dto.idempotencyKey } });
      await tx.downtimeEvent.updateMany({ where: { tenantId, machineId, ownership: "MAINTENANCE", endedAt: null }, data: { endedAt: event.returnedAt, closedAt: event.returnedAt, closedById: userId } }); await this.changeMachineState(tx, tenantId, userId, machine, "AVAILABLE", dto.reason, dto.maintenanceOrderId, dto.breakdownId); await this.audit(tx, tenantId, userId, "return-to-service", event.id, "CREATE", null, event); return event;
    });
  }
  async createCode(tenantId: string, userId: string, dto: any) { return this.prisma.$transaction(async (tx) => { const code = await tx.maintenanceCode.create({ data: { tenantId, kind: dto.kind, code: dto.code, label: dto.label } }); await this.audit(tx, tenantId, userId, "maintenance-code", code.id, "CREATE", null, code); return code; }); }
  async downtimeFacts(tenantId: string, machineId?: string, from?: Date, to?: Date) {
    const rows = await this.prisma.downtimeEvent.findMany({ where: { tenantId, ownership: "MAINTENANCE", ...(machineId ? { machineId } : {}), ...(from || to ? { startedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) }, select: { id: true, tenantId: true, machineId: true, startedAt: true, endedAt: true, maintenanceCategory: true, maintenanceBreakdownId: true, maintenanceOrderId: true, note: true, machine: { select: { plantId: true, name: true } } }, orderBy: { startedAt: "asc" } });
    return rows.map((row) => ({ id: row.id, tenantId: row.tenantId, machineId: row.machineId, plantId: row.machine.plantId, machineName: row.machine.name, start: row.startedAt, end: row.endedAt, durationSeconds: row.endedAt ? Math.max(0, Math.floor((row.endedAt.getTime() - row.startedAt.getTime()) / 1000)) : null, planned: row.maintenanceCategory === "PLANNED_MAINTENANCE", category: row.maintenanceCategory, source: row.maintenanceBreakdownId ? "BREAKDOWN" : "MAINTENANCE_ORDER", relatedBreakdownId: row.maintenanceBreakdownId, relatedMaintenanceOrderId: row.maintenanceOrderId, note: row.note }));
  }

  /**
   * Operator-authorized runtime PM generation. Runtime is accumulated from
   * completed production runs; this endpoint does not infer a controller meter
   * reading or change machine availability.
   */
  async predictiveCheck(tenantId: string, userId: string) {
    const candidates = await this.prisma.machine.findMany({ where: { tenantId, isActive: true, pmIntervalHours: { not: null } } }); const orders: string[] = []; let due = 0; let created = 0; let skippedWithoutPlant = 0;
    for (const candidate of candidates) {
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Machine" WHERE "id"=${candidate.id} AND "tenantId"=${tenantId} FOR UPDATE`;
        const machine = await this.machine(tx, tenantId, candidate.id); if (!machine.isActive || !machine.pmIntervalHours) return { due: false, created: false, orderId: null, skippedWithoutPlant: false };
        const triggerHours = new Prisma.Decimal(machine.lastPmRuntimeHours).plus(machine.pmIntervalHours); if (new Prisma.Decimal(machine.runtimeHours).lt(triggerHours)) return { due: false, created: false, orderId: null, skippedWithoutPlant: false };
        if (!machine.plantId) return { due: true, created: false, orderId: null, skippedWithoutPlant: true };
        const existing = await tx.maintenanceOrder.findFirst({ where: { tenantId, machineId: machine.id, runtimeTriggerHours: triggerHours }, include: ORDER_INCLUDE }); if (existing) return { due: true, created: false, orderId: existing.id, skippedWithoutPlant: false };
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('cmms-maintenance-order-number'))`; const bakNo = await nextDocNo(tx, "maintenanceOrder", "bakNo", "BAK");
        const order = await tx.maintenanceOrder.create({ data: { tenantId, plantId: machine.plantId, bakNo, machineId: machine.id, type: "PREVENTIVE", priority: "MEDIUM", status: "DRAFT", scheduledDate: new Date(), runtimeTriggerHours: triggerHours, description: `Runtime PM due at ${triggerHours.toString()} h`, idempotencyKey: `runtime-pm:${machine.id}:${triggerHours.toString()}`, createdById: userId }, include: ORDER_INCLUDE });
        await this.audit(tx, tenantId, userId, "maintenance-order", order.id, "CREATE", null, { ...order, runtimePm: true }); await this.outbox.record(tx, tenantId, "maintenanceorder", order.id, "maintenanceorder.updated", { id: order.id, runtimePm: true }); return { due: true, created: true, orderId: order.id, skippedWithoutPlant: false };
      });
      if (result.due) due += 1; if (result.created) created += 1; if (result.orderId) orders.push(result.orderId); if (result.skippedWithoutPlant) skippedWithoutPlant += 1;
    }
    return { checked: candidates.length, due, created, orders, skippedWithoutPlant, qualification: "PRODUCTION_RUNTIME_DERIVED_PM" };
  }

  private async machine(db: Tx | PrismaService, tenantId: string, id: string) { const item = await db.machine.findFirst({ where: { id, tenantId } }); if (!item) throw new NotFoundException("Maintainable asset was not found"); return item; }
  private async order(db: Tx | PrismaService, tenantId: string, id: string) { const item = await db.maintenanceOrder.findFirst({ where: { id, tenantId } }); if (!item) throw new NotFoundException("Maintenance work order was not found"); return item; }
  private async changeMachineState(tx: Tx, tenantId: string, userId: string, machine: any, toState: any, reason: string, maintenanceOrderId?: string, breakdownId?: string) { if (machine.maintenanceState === toState) return; await tx.machine.update({ where: { id: machine.id }, data: { maintenanceState: toState } }); await tx.machineMaintenanceStateEvent.create({ data: { tenantId, machineId: machine.id, fromState: machine.maintenanceState, toState, reason, maintenanceOrderId, breakdownId, actorId: userId } }); }
  private audit(tx: Tx, tenantId: string, userId: string, entity: string, entityId: string, action: "CREATE" | "UPDATE" | "STATUS_CHANGE", before: any, after: any) { return writeTransactionalAudit(tx, { tenantId, userId, entity, entityId, action, before, after }); }
}
