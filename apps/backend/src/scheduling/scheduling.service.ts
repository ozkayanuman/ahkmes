import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { RunFiniteScheduleDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { ProductionCalendarService } from "../production-calendar/production-calendar.service";
import {
  runFiniteScheduler,
  type SchedulerResult,
  type SchedulerWorkOrder,
  type SchedulingDispatchRule,
  type WorkingWindow,
} from "./finite-scheduler";

export interface CapacityRow {
  machineId: string;
  machineName: string;
  date: string;
  loadMinutes: number;
  capacityMinutes: number;
  overloaded: boolean;
}

export interface BottleneckRow {
  machineId: string;
  machineName: string;
  overloadedDays: number;
  totalLoadMinutes: number;
  totalCapacityMinutes: number;
  totalOverloadMinutes: number;
  /** totalLoadMinutes / totalCapacityMinutes; null if the machine had zero capacity across the window. */
  utilization: number | null;
}

export interface FiniteScheduleResult extends SchedulerResult {
  runId: string | null;
  committed: boolean;
  plantId: string | null;
  dispatchRule: SchedulingDispatchRule;
  horizonStart: Date;
  horizonEnd: Date;
  summary: { workOrders: number; scheduledOps: number; unscheduledOps: number; lateWorkOrders: number; machines: number };
}

export interface MachineQueueRow {
  machineId: string;
  machineName: string;
  operations: {
    operationId: string;
    workOrderId: string;
    woNo: string;
    partNo: string;
    seq: number;
    name: string;
    status: string;
    plannedStartAt: Date;
    plannedEndAt: Date;
  }[];
}

const MAX_WINDOW_DAYS = 366;
/** Machines without a plant calendar: dailyCapacityMinutes is laid out from 08:00 Europe/Istanbul (05:00Z). */
const FALLBACK_DAY_START_MINUTE_UTC = 5 * 60;
const UNAVAILABLE_MACHINE_PREFIX = "__unavailable__";
const SCHEDULABLE_WO_STATUSES = ["PLANNED", "RELEASED", "WAITING_MATERIAL", "IN_PRODUCTION"] as const;
const ACTIVE_OP_STATUSES = ["SETUP", "IN_PROGRESS", "PAUSED", "REWORK"] as const;
const DONE_OP_STATUSES = ["COMPLETED", "SKIPPED"] as const;

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Inclusive list of ISO day strings between start and end, capped defensively. */
function eachDateInRange(start: Date, end: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cursor <= last && days.length < MAX_WINDOW_DAYS) {
    days.push(toIsoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days.length > 0 ? days : [toIsoDate(start)];
}

/**
 * AHK-011 (daraltılmış dilim): gerçek finite scheduling değil — sadece
 * standardMinutes (Recipe→WorkOrderOperation snapshot) ve günlük kapasiteden
 * yük/aşım görünürlüğü üretir. Bir iş emrinin operasyon süresi, planlanan
 * pencerenin (plannedStartDate→plannedEndDate) her gününe eşit dağıtılır —
 * bilinçli basitleştirme, gerçek sıralı zamanlama (alternatif kaynak
 * ataması, kapasite dengeleme/optimizasyon) kapsam dışıdır. Günlük kapasite
 * artık makinenin tesisinde aktif bir PlantProductionCalendar varsa gerçek
 * vardiya penceresinden (mola süreleri düşülerek) hesaplanır; tesisin
 * takvimi yoksa Machine.dailyCapacityMinutes'a geri düşer (geriye dönük
 * uyumlu).
 */
@Injectable()
export class SchedulingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly productionCalendar: ProductionCalendarService,
  ) {}

  async capacity(tenantId: string, from: Date, to: Date): Promise<CapacityRow[]> {
    const machines = await this.prisma.machine.findMany({
      where: { tenantId, dailyCapacityMinutes: { not: null } },
      select: { id: true, name: true, dailyCapacityMinutes: true, plantId: true },
    });
    if (machines.length === 0) return [];

    const capacityByMachine = new Map(
      machines.map((m) => [m.id, { name: m.name, fallbackCapacityMinutes: Number(m.dailyCapacityMinutes), plantId: m.plantId }]),
    );

    const workOrders = await this.prisma.workOrder.findMany({
      where: {
        tenantId,
        status: { notIn: ["CANCELLED", "COMPLETED"] },
        plannedStartDate: { not: null, lte: to },
        plannedEndDate: { not: null, gte: from },
      },
      select: {
        plannedStartDate: true,
        plannedEndDate: true,
        operations: { select: { machineId: true, standardMinutes: true, plannedStartAt: true, plannedEndAt: true } },
      },
    });

    const fromIso = toIsoDate(from);
    const toIso = toIsoDate(to);
    const loadByKey = new Map<string, number>();

    for (const wo of workOrders) {
      const woDays = eachDateInRange(wo.plannedStartDate!, wo.plannedEndDate!);
      for (const op of wo.operations) {
        if (!op.machineId || op.standardMinutes === null) continue;
        if (!capacityByMachine.has(op.machineId)) continue;
        // A finitely scheduled operation carries its own window; otherwise the
        // coarse work-order window is spread evenly (pre-MRP II behaviour).
        const days = op.plannedStartAt && op.plannedEndAt ? eachDateInRange(op.plannedStartAt, op.plannedEndAt) : woDays;
        const perDay = Number(op.standardMinutes) / days.length;
        for (const day of days) {
          if (day < fromIso || day > toIso) continue;
          const key = `${op.machineId}|${day}`;
          loadByKey.set(key, (loadByKey.get(key) ?? 0) + perDay);
        }
      }
    }

    const requestedDays = new Set<string>();
    for (const key of loadByKey.keys()) requestedDays.add(key.split("|")[1]);
    const plantIds = [...new Set(machines.map((m) => m.plantId).filter((id): id is string => !!id))];
    const calendarMinutesByPlantDay = await this.resolveCalendarCapacity(tenantId, plantIds, [...requestedDays]);

    const result: CapacityRow[] = [];
    for (const [key, loadMinutes] of loadByKey) {
      const [machineId, date] = key.split("|");
      const machine = capacityByMachine.get(machineId)!;
      const calendarMinutes = machine.plantId ? calendarMinutesByPlantDay.get(`${machine.plantId}|${date}`) : undefined;
      const capacityMinutes = calendarMinutes ?? machine.fallbackCapacityMinutes;
      result.push({
        machineId,
        machineName: machine.name,
        date,
        loadMinutes: Math.round(loadMinutes * 100) / 100,
        capacityMinutes,
        overloaded: loadMinutes > capacityMinutes,
      });
    }
    return result.sort((a, b) => a.date.localeCompare(b.date) || a.machineName.localeCompare(b.machineName));
  }

  /**
   * Aggregates capacity() across the window per machine to surface the
   * persistent bottlenecks — not just "overloaded on some day" but ranked by
   * how much and how often. Machines with zero overloaded days in the window
   * are omitted; this is a shortage/bottleneck report, not a full utilization
   * dashboard.
   */
  async bottlenecks(tenantId: string, from: Date, to: Date): Promise<BottleneckRow[]> {
    const rows = await this.capacity(tenantId, from, to);
    const byMachine = new Map<string, { machineName: string; overloadedDays: number; totalLoadMinutes: number; totalCapacityMinutes: number; totalOverloadMinutes: number }>();
    for (const row of rows) {
      const entry = byMachine.get(row.machineId) ?? { machineName: row.machineName, overloadedDays: 0, totalLoadMinutes: 0, totalCapacityMinutes: 0, totalOverloadMinutes: 0 };
      entry.totalLoadMinutes += row.loadMinutes;
      entry.totalCapacityMinutes += row.capacityMinutes;
      if (row.overloaded) {
        entry.overloadedDays += 1;
        entry.totalOverloadMinutes += row.loadMinutes - row.capacityMinutes;
      }
      byMachine.set(row.machineId, entry);
    }
    const result: BottleneckRow[] = [];
    for (const [machineId, entry] of byMachine) {
      if (entry.overloadedDays === 0) continue;
      result.push({
        machineId,
        machineName: entry.machineName,
        overloadedDays: entry.overloadedDays,
        totalLoadMinutes: Math.round(entry.totalLoadMinutes * 100) / 100,
        totalCapacityMinutes: Math.round(entry.totalCapacityMinutes * 100) / 100,
        totalOverloadMinutes: Math.round(entry.totalOverloadMinutes * 100) / 100,
        utilization: entry.totalCapacityMinutes > 0 ? Math.round((entry.totalLoadMinutes / entry.totalCapacityMinutes) * 10000) / 10000 : null,
      });
    }
    return result.sort((a, b) => b.totalOverloadMinutes - a.totalOverloadMinutes || b.overloadedDays - a.overloadedDays);
  }

  /**
   * MRP II finite-capacity scheduling. Pulls schedulable work orders and their
   * released operations, derives per-machine working windows from the plant
   * shift calendar (or the static daily capacity fallback), runs the pure
   * scheduler and — only when `commit` is true — writes operation windows and
   * a SchedulingRun snapshot in one transaction.
   */
  async runFiniteSchedule(tenantId: string, userId: string, dto: RunFiniteScheduleDto): Promise<FiniteScheduleResult> {
    const horizonStart = dto.horizonStart ?? new Date();
    const horizonEnd = new Date(horizonStart.getTime() + dto.horizonDays * 24 * 3600 * 1000);
    const plantId = dto.plantId ?? null;

    const machines = await this.prisma.machine.findMany({
      where: { tenantId, isActive: true, ...(plantId ? { plantId } : {}) },
      select: { id: true, name: true, plantId: true, dailyCapacityMinutes: true },
    });
    const machineIds = new Set(machines.map((m) => m.id));

    const workOrders = await this.prisma.workOrder.findMany({
      where: { tenantId, status: { in: [...SCHEDULABLE_WO_STATUSES] }, ...(plantId ? { plantId } : {}) },
      select: {
        id: true, woNo: true, priority: true, dueDate: true, createdAt: true, quantity: true,
        operations: { select: { id: true, seq: true, name: true, machineId: true, standardMinutes: true, status: true, completedQty: true, scrapQty: true } },
      },
    });

    const schedulerWorkOrders: SchedulerWorkOrder[] = workOrders.map((wo) => {
      const quantity = Number(wo.quantity);
      return {
        id: wo.id, woNo: wo.woNo, priority: wo.priority, dueDate: wo.dueDate, createdAt: wo.createdAt,
        operations: wo.operations.map((op) => {
          let remainingMinutes: number | null = op.standardMinutes === null ? null : Number(op.standardMinutes);
          if (remainingMinutes !== null && (ACTIVE_OP_STATUSES as readonly string[]).includes(op.status) && quantity > 0) {
            const doneShare = Math.min(1, (Number(op.completedQty) + Number(op.scrapQty)) / quantity);
            remainingMinutes = Math.round(remainingMinutes * (1 - doneShare) * 100) / 100;
          }
          // Operations pointing at an inactive / other-plant machine are reported as NO_MACHINE_CAPACITY, not NO_MACHINE.
          const machineId = op.machineId && !machineIds.has(op.machineId) ? `${UNAVAILABLE_MACHINE_PREFIX}${op.machineId}` : op.machineId;
          return { id: op.id, seq: op.seq, name: op.name, machineId, status: op.status, remainingMinutes };
        }),
      };
    });

    const windowsByMachine = await this.resolveWorkingWindows(tenantId, machines, horizonStart, horizonEnd);
    const result = runFiniteScheduler({
      horizonStart, horizonEnd, dispatchRule: dto.dispatchRule, workOrders: schedulerWorkOrders, windowsByMachine,
      machineNames: new Map(machines.map((m) => [m.id, m.name])),
    });
    for (const u of result.unscheduled) {
      if (u.machineId?.startsWith(UNAVAILABLE_MACHINE_PREFIX)) u.machineId = u.machineId.slice(UNAVAILABLE_MACHINE_PREFIX.length);
    }

    const summary = {
      workOrders: result.workOrders.length,
      scheduledOps: result.operations.length,
      unscheduledOps: result.unscheduled.length,
      lateWorkOrders: result.workOrders.filter((w) => w.late).length,
      machines: windowsByMachine.size,
    };
    const base = { ...result, committed: dto.commit, plantId, dispatchRule: dto.dispatchRule, horizonStart, horizonEnd, summary };
    if (!dto.commit) return { ...base, runId: null };

    const runId = await this.prisma.$transaction(async (tx) => {
      // One committed schedule per tenant at a time: a concurrent commit would interleave operation windows.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`scheduling-run:${tenantId}`}))`;
      const run = await tx.schedulingRun.create({
        data: {
          tenantId, plantId, dispatchRule: dto.dispatchRule, horizonStart, horizonEnd, committed: true,
          scheduledOps: summary.scheduledOps, unscheduledOps: summary.unscheduledOps, lateWorkOrders: summary.lateWorkOrders,
          result: { workOrders: result.workOrders, operations: result.operations, unscheduled: result.unscheduled, summary } as unknown as Prisma.InputJsonValue,
          createdById: userId,
        },
        select: { id: true },
      });
      const consideredWoIds = workOrders.map((w) => w.id);
      const scheduledOpIds = result.operations.map((o) => o.operationId);
      // Stale windows from an earlier run must not survive on operations this run could not place.
      await tx.workOrderOperation.updateMany({
        where: { tenantId, workOrderId: { in: consideredWoIds }, id: { notIn: scheduledOpIds }, status: { notIn: [...DONE_OP_STATUSES] } },
        data: { plannedStartAt: null, plannedEndAt: null, schedulingRunId: null },
      });
      for (const op of result.operations) {
        await tx.workOrderOperation.update({
          where: { id: op.operationId },
          data: { plannedStartAt: op.start, plannedEndAt: op.end, schedulingRunId: run.id },
        });
      }
      for (const wo of result.workOrders) {
        if (!wo.plannedStart || !wo.plannedEnd) continue;
        await tx.workOrder.update({ where: { id: wo.workOrderId }, data: { plannedStartDate: wo.plannedStart, plannedEndDate: wo.plannedEnd } });
      }
      return run.id;
    });
    return { ...base, runId };
  }

  listRuns(tenantId: string, take = 20) {
    return this.prisma.schedulingRun.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true, plantId: true, dispatchRule: true, horizonStart: true, horizonEnd: true, committed: true,
        scheduledOps: true, unscheduledOps: true, lateWorkOrders: true, createdAt: true,
        createdBy: { select: { id: true, name: true } },
      },
    });
  }

  async getRun(tenantId: string, id: string) {
    const run = await this.prisma.schedulingRun.findFirst({ where: { id, tenantId }, include: { createdBy: { select: { id: true, name: true } } } });
    if (!run) throw new NotFoundException("Çizelgeleme koşusu bulunamadı");
    return run;
  }

  /** Committed operation windows per machine for a time range — the dispatch list / machine Gantt feed. */
  async machineQueue(tenantId: string, from: Date, to: Date, plantId?: string): Promise<MachineQueueRow[]> {
    const ops = await this.prisma.workOrderOperation.findMany({
      where: {
        tenantId, machineId: { not: null }, plannedStartAt: { not: null, lte: to }, plannedEndAt: { not: null, gte: from },
        status: { notIn: [...DONE_OP_STATUSES] },
        ...(plantId ? { machine: { plantId } } : {}),
      },
      select: {
        id: true, workOrderId: true, seq: true, name: true, status: true, plannedStartAt: true, plannedEndAt: true,
        machine: { select: { id: true, name: true } },
        workOrder: { select: { woNo: true, part: { select: { partNo: true } } } },
      },
      orderBy: [{ plannedStartAt: "asc" }, { seq: "asc" }],
    });
    const byMachine = new Map<string, MachineQueueRow>();
    for (const op of ops) {
      if (!op.machine || !op.plannedStartAt || !op.plannedEndAt) continue;
      const row = byMachine.get(op.machine.id) ?? { machineId: op.machine.id, machineName: op.machine.name, operations: [] };
      row.operations.push({
        operationId: op.id, workOrderId: op.workOrderId, woNo: op.workOrder.woNo, partNo: op.workOrder.part.partNo,
        seq: op.seq, name: op.name, status: op.status, plannedStartAt: op.plannedStartAt, plannedEndAt: op.plannedEndAt,
      });
      byMachine.set(op.machine.id, row);
    }
    return [...byMachine.values()].sort((a, b) => a.machineName.localeCompare(b.machineName));
  }

  /**
   * Working windows per machine across the horizon. Plants with an active
   * calendar on a day contribute their real shift windows minus valid breaks
   * (non-working days contribute nothing — no silent fallback). Machines whose
   * plant has no calendar on that day fall back to dailyCapacityMinutes laid
   * out from 08:00 Istanbul; machines with neither have no capacity.
   */
  private async resolveWorkingWindows(
    tenantId: string,
    machines: { id: string; plantId: string | null; dailyCapacityMinutes: Prisma.Decimal | number | null }[],
    horizonStart: Date,
    horizonEnd: Date,
  ): Promise<Map<string, WorkingWindow[]>> {
    // One day of slack on each side absorbs plant-timezone offsets against the UTC day grid.
    const dayFrom = new Date(horizonStart.getTime() - 24 * 3600 * 1000);
    const days = eachDateInRange(dayFrom, horizonEnd);
    const plantIds = [...new Set(machines.map((m) => m.plantId).filter((id): id is string => !!id))];

    const windowsByPlantDay = new Map<string, WorkingWindow[]>();
    await Promise.all(
      plantIds.flatMap((plantId) =>
        days.map(async (day) => {
          const at = new Date(`${day}T00:00:00.000Z`);
          const calendar = await this.prisma.plantProductionCalendar.findFirst({
            where: {
              tenantId, plantId, isActive: true,
              AND: [
                { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: at } }] },
                { OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }] },
              ],
            },
            select: { id: true },
          });
          if (!calendar) return;
          const shifts = await this.productionCalendar.shiftWindowsForProductionDate(tenantId, plantId, day);
          const windows: WorkingWindow[] = [];
          for (const shift of shifts) {
            if (!shift.start || !shift.end) continue;
            let cursor = shift.start.getTime();
            const breaks = shift.breaks
              .filter((b) => b.isValidWithinShift && b.start && b.end)
              .sort((a, b) => a.start!.getTime() - b.start!.getTime());
            for (const b of breaks) {
              if (b.start!.getTime() > cursor) windows.push({ start: new Date(cursor), end: new Date(b.start!.getTime()) });
              cursor = Math.max(cursor, b.end!.getTime());
            }
            if (cursor < shift.end.getTime()) windows.push({ start: new Date(cursor), end: new Date(shift.end.getTime()) });
          }
          // Present (possibly empty) means "a calendar governs this day" — never fall back to static capacity.
          windowsByPlantDay.set(`${plantId}|${day}`, windows);
        }),
      ),
    );

    const result = new Map<string, WorkingWindow[]>();
    for (const machine of machines) {
      const windows: WorkingWindow[] = [];
      const fallbackMinutes = machine.dailyCapacityMinutes === null ? null : Number(machine.dailyCapacityMinutes);
      for (const day of days) {
        const governed = machine.plantId ? windowsByPlantDay.get(`${machine.plantId}|${day}`) : undefined;
        if (governed) {
          windows.push(...governed);
        } else if (fallbackMinutes !== null && fallbackMinutes > 0) {
          const start = new Date(`${day}T00:00:00.000Z`).getTime() + FALLBACK_DAY_START_MINUTE_UTC * 60_000;
          windows.push({ start: new Date(start), end: new Date(start + fallbackMinutes * 60_000) });
        }
      }
      if (windows.length > 0) result.set(machine.id, windows);
    }
    return result;
  }

  /**
   * Real shift-calendar minutes per (plantId, day), only for plants that have
   * an active calendar effective on that day. A day is present in the map
   * (possibly as 0) whenever a calendar applies — including non-working days,
   * which must yield 0 rather than falling back to the static machine
   * capacity. Absence from the map means "no calendar configured" — the
   * caller falls back to Machine.dailyCapacityMinutes for those.
   */
  private async resolveCalendarCapacity(tenantId: string, plantIds: string[], days: string[]) {
    const result = new Map<string, number>();
    await Promise.all(
      plantIds.flatMap((plantId) =>
        days.map(async (day) => {
          const at = new Date(`${day}T00:00:00.000Z`);
          const calendar = await this.prisma.plantProductionCalendar.findFirst({
            where: {
              tenantId, plantId, isActive: true,
              AND: [
                { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: at } }] },
                { OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }] },
              ],
            },
            select: { id: true },
          });
          if (!calendar) return;
          const windows = await this.productionCalendar.shiftWindowsForProductionDate(tenantId, plantId, day);
          const minutes = windows.reduce((sum, shift) => {
            if (!shift.start || !shift.end) return sum;
            const shiftMinutes = (shift.end.getTime() - shift.start.getTime()) / 60000;
            const breakMinutes = shift.breaks
              .filter((b) => b.isValidWithinShift && b.start && b.end)
              .reduce((sub, b) => sub + (b.end!.getTime() - b.start!.getTime()) / 60000, 0);
            return sum + Math.max(0, shiftMinutes - breakMinutes);
          }, 0);
          result.set(`${plantId}|${day}`, Math.round(minutes * 100) / 100);
        }),
      ),
    );
    return result;
  }
}
