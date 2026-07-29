import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/** Vardiya tanımları (sabit) — bu sürümde vardiya yönetimi CRUD'u yok, sektörde
 * yaygın 3 vardiyalı düzen (06-14 / 14-22 / 22-06) sabit kabul edilir. */
const SHIFT_DEFS = [
  { shift: 1, label: "Vardiya 1 (06:00–14:00)", startHour: 6, endHour: 14 },
  { shift: 2, label: "Vardiya 2 (14:00–22:00)", startHour: 14, endHour: 22 },
  { shift: 3, label: "Vardiya 3 (22:00–06:00)", startHour: 22, endHour: 30 },
] as const;

function shiftWindow(date: Date, startHour: number, endHour: number) {
  const start = new Date(date);
  start.setHours(startHour, 0, 0, 0);
  const end = new Date(date);
  end.setHours(endHour, 0, 0, 0);
  return { start, end };
}

@Injectable()
export class ShiftReportService {
  constructor(private readonly prisma: PrismaService) {}

  /** Bir günün 3 vardiyası için üretim özeti — goodCount/scrapCount, OEE bileşenleri
   * ve toplam duruş süresi. Aynı yaklaşımı OeeService.trend ile paylaşır: koşu,
   * başladığı vardiyaya göre kovaya atanır (vardiyayı aşan koşularda tam süre sayılır). */
  async report(tenantId: string, date: Date) {
    const results = [];
    for (const def of SHIFT_DEFS) {
      const { start, end } = shiftWindow(date, def.startHour, def.endHour);

      const runs = await this.prisma.productionRun.findMany({
        where: { tenantId, startedAt: { gte: start, lt: end } },
        include: { workOrder: { include: { part: { select: { idealCycleTimeSec: true } } } } },
      });

      let goodCount = 0;
      let scrapCount = 0;
      let runtimeSeconds = 0;
      let idealSeconds = 0;
      for (const run of runs) {
        goodCount += run.goodCount;
        scrapCount += run.scrapCount;
        const runEnd = run.endedAt ?? new Date();
        runtimeSeconds += Math.max(0, (runEnd.getTime() - run.startedAt.getTime()) / 1000);
        const ideal = run.workOrder.part.idealCycleTimeSec ? Number(run.workOrder.part.idealCycleTimeSec) : null;
        if (ideal) idealSeconds += ideal * run.goodCount;
      }

      const machineIds = [...new Set(runs.map((r) => r.machineId).filter((id): id is string => !!id))];
      let downtimeSeconds = 0;
      if (machineIds.length > 0) {
        const events = await this.prisma.machineStatusEvent.findMany({
          where: { tenantId, machineId: { in: machineIds }, occurredAt: { gte: start, lt: end } },
          orderBy: { occurredAt: "asc" },
        });
        const byMachine = new Map<string, typeof events>();
        for (const ev of events) {
          const list = byMachine.get(ev.machineId) ?? [];
          list.push(ev);
          byMachine.set(ev.machineId, list);
        }
        for (const list of byMachine.values()) {
          for (let i = 0; i < list.length; i++) {
            if (list[i].type !== "ALARM") continue;
            const evEnd = list[i + 1]?.occurredAt ?? end;
            downtimeSeconds += Math.max(0, (evEnd.getTime() - list[i].occurredAt.getTime()) / 1000);
          }
        }
      }

      const total = goodCount + scrapCount;
      const quality = total > 0 ? goodCount / total : null;
      const performance = idealSeconds > 0 && runtimeSeconds > 0 ? Math.min(1, idealSeconds / runtimeSeconds) : null;
      const availability =
        runtimeSeconds > 0 ? Math.max(0, Math.min(1, 1 - downtimeSeconds / runtimeSeconds)) : null;
      const oee =
        quality !== null && performance !== null ? quality * performance * (availability ?? 1) : null;

      results.push({
        shift: def.shift,
        label: def.label,
        start: start.toISOString(),
        end: end.toISOString(),
        goodCount,
        scrapCount,
        quality,
        performance,
        availability,
        oee,
        downtimeSeconds: Math.round(downtimeSeconds),
      });
    }
    return results;
  }
}
