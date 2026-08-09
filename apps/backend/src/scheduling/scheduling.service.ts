import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface CapacityRow {
  machineId: string;
  machineName: string;
  date: string;
  loadMinutes: number;
  capacityMinutes: number;
  overloaded: boolean;
}

const MAX_WINDOW_DAYS = 366;

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
 * standardMinutes (Recipe→WorkOrderOperation snapshot) ve dailyCapacityMinutes
 * (Machine, opsiyonel) verisinden günlük yük/aşım görünürlüğü üretir. Bir iş
 * emrinin operasyon süresi, planlanan pencerenin (plannedStartDate→plannedEndDate)
 * her gününe eşit dağıtılır — bilinçli basitleştirme, gerçek sıralı zamanlama
 * (alternatif kaynak, vardiya takvimi) kapsam dışıdır.
 */
@Injectable()
export class SchedulingService {
  constructor(private readonly prisma: PrismaService) {}

  async capacity(tenantId: string, from: Date, to: Date): Promise<CapacityRow[]> {
    const machines = await this.prisma.machine.findMany({
      where: { tenantId, dailyCapacityMinutes: { not: null } },
      select: { id: true, name: true, dailyCapacityMinutes: true },
    });
    if (machines.length === 0) return [];

    const capacityByMachine = new Map(
      machines.map((m) => [m.id, { name: m.name, capacityMinutes: Number(m.dailyCapacityMinutes) }]),
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
        operations: { select: { machineId: true, standardMinutes: true } },
      },
    });

    const fromIso = toIsoDate(from);
    const toIso = toIsoDate(to);
    const loadByKey = new Map<string, number>();

    for (const wo of workOrders) {
      const days = eachDateInRange(wo.plannedStartDate!, wo.plannedEndDate!);
      for (const op of wo.operations) {
        if (!op.machineId || op.standardMinutes === null) continue;
        if (!capacityByMachine.has(op.machineId)) continue;
        const perDay = Number(op.standardMinutes) / days.length;
        for (const day of days) {
          if (day < fromIso || day > toIso) continue;
          const key = `${op.machineId}|${day}`;
          loadByKey.set(key, (loadByKey.get(key) ?? 0) + perDay);
        }
      }
    }

    const result: CapacityRow[] = [];
    for (const [key, loadMinutes] of loadByKey) {
      const [machineId, date] = key.split("|");
      const machine = capacityByMachine.get(machineId)!;
      result.push({
        machineId,
        machineName: machine.name,
        date,
        loadMinutes: Math.round(loadMinutes * 100) / 100,
        capacityMinutes: machine.capacityMinutes,
        overloaded: loadMinutes > machine.capacityMinutes,
      });
    }
    return result.sort((a, b) => a.date.localeCompare(b.date) || a.machineName.localeCompare(b.machineName));
  }
}
