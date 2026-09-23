import { Injectable } from "@nestjs/common";
import type { OeeCalculationRequest } from "./oee-calculation.service";
import { OeeCalculationService } from "./oee-calculation.service";
import { PrismaService } from "../prisma/prisma.service";

type CockpitRequest = OeeCalculationRequest;

/** Read-only cockpit projection. It never invents time loss from a CMMS/MRP status. */
@Injectable()
export class OeeCockpitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calculation: OeeCalculationService,
  ) {}

  async read(request: CockpitRequest) {
    const cutoff = new Date(Math.min(request.to.getTime(), request.asOf.getTime()));
    const [plant, machines, maintenanceOrders, qualityHolds, materialExceptions, workOrders, summary] = await Promise.all([
      this.prisma.plant.findFirst({ where: { id: request.plantId, tenantId: request.tenantId }, select: { id: true, name: true } }),
      this.prisma.machine.findMany({
        where: { tenantId: request.tenantId, plantId: request.plantId },
        select: { id: true, name: true, lastStatus: true, lastEventAt: true, activeWorkOrder: { select: { id: true, woNo: true, status: true } } },
        orderBy: { name: "asc" },
      }),
      this.prisma.maintenanceOrder.findMany({
        where: { tenantId: request.tenantId, plantId: request.plantId, status: { in: ["PLANNED", "IN_PROGRESS", "ON_HOLD"] } },
        select: { id: true, machineId: true, bakNo: true, status: true, priority: true, plannedStart: true, plannedFinish: true, blockingFrom: true, blockingUntil: true },
        orderBy: [{ priority: "desc" }, { plannedStart: "asc" }],
      }),
      this.prisma.qualityHold.findMany({
        where: { tenantId: request.tenantId, status: "ACTIVE", createdAt: { lte: cutoff }, workOrder: { plantId: request.plantId } },
        select: { id: true, workOrderId: true, operationId: true, reason: true, createdAt: true, quantity: true },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.mrpException.findMany({
        where: { tenantId: request.tenantId, plantId: request.plantId, acknowledgedAt: null },
        select: { id: true, type: true, severity: true, itemType: true, itemId: true, requiredDate: true, explanation: true },
        orderBy: [{ severity: "desc" }, { requiredDate: "asc" }],
      }),
      // Work-order state is intentionally a current WIP projection, not an
      // as-of reconstruction like the timestamped OEE facts above.
      this.prisma.workOrder.findMany({
        where: { tenantId: request.tenantId, plantId: request.plantId, status: { in: ["PLANNED", "RELEASED", "WAITING_MATERIAL", "IN_PRODUCTION"] } },
        select: {
          id: true, woNo: true, dueDate: true, quantity: true, status: true,
          part: { select: { id: true, partNo: true, name: true } },
          operations: { select: { status: true } },
        },
        orderBy: [{ dueDate: "asc" }, { woNo: "asc" }],
      }),
      this.calculation.calculate(request),
    ]);

    const machineByWorkOrder = new Map<string, string[]>();
    for (const machine of machines) {
      if (!machine.activeWorkOrder) continue;
      const ids = machineByWorkOrder.get(machine.activeWorkOrder.id) ?? [];
      ids.push(machine.id);
      machineByWorkOrder.set(machine.activeWorkOrder.id, ids);
    }
    const byWorkOrder = await this.calculation.calculateForWorkOrders(request, [...machineByWorkOrder.keys()]);

    const maintenanceByMachine = groupIds(maintenanceOrders, (item) => item.machineId);
    const overdueWorkOrders = workOrders.filter((order) => order.dueDate < cutoff);
    const workOrderStateAt = new Date();
    return {
      plant,
      context: { plantId: request.plantId, from: request.from, to: request.to, asOf: cutoff, lastRefreshedAt: workOrderStateAt, workOrderStateAt },
      summary: { metrics: summary.metrics, sources: summary.sources, timeline: summary.timeline },
      machines: machines.map((machine) => {
        const calculation = machine.activeWorkOrder ? byWorkOrder.get(machine.activeWorkOrder.id) : undefined;
        return {
          id: machine.id, name: machine.name, currentStatus: machine.lastStatus, lastEventAt: machine.lastEventAt,
          activeWorkOrder: machine.activeWorkOrder,
          oee: calculation ? { value: calculation.metrics.oee.value, dataQuality: calculation.metrics.dataQuality, facts: calculation.metrics.facts, issues: calculation.metrics.issues } : null,
          maintenanceOrderIds: (maintenanceByMachine.get(machine.id) ?? []).map((item) => item.id),
        };
      }),
      blockers: {
        maintenance: maintenanceOrders,
        qualityHolds: qualityHolds.map((hold) => ({ ...hold, quantity: numberValue(hold.quantity) })),
        materialExceptions,
      },
      workOrders: {
        currentStateAt: workOrderStateAt,
        summary: {
          openCount: workOrders.length,
          inProductionCount: workOrders.filter((order) => order.status === "IN_PRODUCTION").length,
          waitingMaterialCount: workOrders.filter((order) => order.status === "WAITING_MATERIAL").length,
          overdueCount: overdueWorkOrders.length,
          blockedOperationCount: workOrders.reduce((total, order) => total + order.operations.filter((operation) => operation.status === "BLOCKED").length, 0),
        },
        overdue: overdueWorkOrders.slice(0, 20).map((order) => ({
          id: order.id,
          woNo: order.woNo,
          status: order.status,
          dueDate: order.dueDate,
          quantity: numberValue(order.quantity),
          part: { id: order.part.id, code: order.part.partNo, name: order.part.name },
          blockedOperationCount: order.operations.filter((operation) => operation.status === "BLOCKED").length,
        })),
      },
    };
  }
}

function groupIds<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) grouped.set(key(item), [...(grouped.get(key(item)) ?? []), item]);
  return grouped;
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && value !== null && "toNumber" in value && typeof (value as { toNumber?: unknown }).toNumber === "function") return (value as { toNumber: () => number }).toNumber();
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
