import { Injectable } from "@nestjs/common";
import type { MachineStatusEvent } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

interface DayBucket {
  date: string;
  goodCount: number;
  scrapCount: number;
  runtimeSeconds: number;
  idealSeconds: number;
  downtimeSeconds: number;
}

/** ALARM olayından, aynı makinede sıradaki olaya (yoksa "şu an"a) kadar geçen süreyi
 * duruş (downtime) olarak sayar — geçmişten türetilen gerçek değer, tahmini/sahte değil. */
function alarmDurations(events: MachineStatusEvent[]) {
  const byMachine = new Map<string, MachineStatusEvent[]>();
  for (const ev of events) {
    const list = byMachine.get(ev.machineId) ?? [];
    list.push(ev);
    byMachine.set(ev.machineId, list);
  }
  const durations: { start: Date; seconds: number; reason: string }[] = [];
  for (const list of byMachine.values()) {
    for (let i = 0; i < list.length; i++) {
      const ev = list[i];
      if (ev.type !== "ALARM") continue;
      const next = list[i + 1];
      const end = next ? next.occurredAt : new Date();
      const seconds = Math.max(0, (end.getTime() - ev.occurredAt.getTime()) / 1000);
      durations.push({ start: ev.occurredAt, seconds, reason: ev.message ?? "Bilinmeyen" });
    }
  }
  return durations;
}

@Injectable()
export class OeeService {
  constructor(private readonly prisma: PrismaService) {}

  /** Günlük OEE bileşenlerini (quality/performance/availability) ve toplam duruş süresini döner. */
  async trend(tenantId: string, days: number) {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);

    const runs = await this.prisma.productionRun.findMany({
      where: { tenantId, startedAt: { gte: since } },
      include: { workOrder: { include: { part: { select: { idealCycleTimeSec: true } } } } },
    });
    const events = await this.prisma.machineStatusEvent.findMany({
      where: { tenantId, occurredAt: { gte: since } },
      orderBy: { occurredAt: "asc" },
    });

    const buckets = new Map<string, DayBucket>();
    const bucketFor = (date: string) => {
      let b = buckets.get(date);
      if (!b) {
        b = { date, goodCount: 0, scrapCount: 0, runtimeSeconds: 0, idealSeconds: 0, downtimeSeconds: 0 };
        buckets.set(date, b);
      }
      return b;
    };

    for (const run of runs) {
      const day = run.startedAt.toISOString().slice(0, 10);
      const b = bucketFor(day);
      b.goodCount += run.goodCount;
      b.scrapCount += run.scrapCount;
      const end = run.endedAt ?? new Date();
      b.runtimeSeconds += Math.max(0, (end.getTime() - run.startedAt.getTime()) / 1000);
      const ideal = run.workOrder.part.idealCycleTimeSec ? Number(run.workOrder.part.idealCycleTimeSec) : null;
      if (ideal) b.idealSeconds += ideal * run.goodCount;
    }

    for (const d of alarmDurations(events)) {
      const day = d.start.toISOString().slice(0, 10);
      bucketFor(day).downtimeSeconds += d.seconds;
    }

    return Array.from(buckets.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((b) => {
        const total = b.goodCount + b.scrapCount;
        const quality = total > 0 ? b.goodCount / total : null;
        const performance =
          b.idealSeconds > 0 && b.runtimeSeconds > 0 ? Math.min(1, b.idealSeconds / b.runtimeSeconds) : null;
        const availability =
          b.runtimeSeconds > 0 ? Math.max(0, Math.min(1, 1 - b.downtimeSeconds / b.runtimeSeconds)) : null;
        const oee =
          quality !== null && performance !== null && availability !== null
            ? quality * performance * availability
            : null;
        return {
          date: b.date,
          goodCount: b.goodCount,
          scrapCount: b.scrapCount,
          quality,
          performance,
          availability,
          oee,
          downtimeSeconds: Math.round(b.downtimeSeconds),
        };
      });
  }

  /** Duruş nedenlerini toplam süreye göre azalan sırayla döner (Pareto analizi). */
  async downtimePareto(tenantId: string, days: number) {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const events = await this.prisma.machineStatusEvent.findMany({
      where: { tenantId, occurredAt: { gte: since } },
      orderBy: { occurredAt: "asc" },
    });

    const byReason = new Map<string, { reason: string; totalSeconds: number; count: number }>();
    for (const d of alarmDurations(events)) {
      const entry = byReason.get(d.reason) ?? { reason: d.reason, totalSeconds: 0, count: 0 };
      entry.totalSeconds += d.seconds;
      entry.count += 1;
      byReason.set(d.reason, entry);
    }

    return Array.from(byReason.values())
      .sort((a, b) => b.totalSeconds - a.totalSeconds)
      .map((r) => ({ ...r, totalSeconds: Math.round(r.totalSeconds) }));
  }
}
