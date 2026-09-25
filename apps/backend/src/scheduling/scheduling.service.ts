import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ProductionCalendarService } from "../production-calendar/production-calendar.service";

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
