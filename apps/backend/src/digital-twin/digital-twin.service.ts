import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CreateMachineConnectionDto, UpdateMachinePositionDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";

const MACHINE_SELECT = {
  id: true,
  name: true,
  model: true,
  controller: true,
  isActive: true,
  lastStatus: true,
  lastEventAt: true,
  posX: true,
  posY: true,
  runtimeHours: true,
  activeWorkOrder: { select: { id: true, woNo: true, status: true } },
} as const;

interface MachineMetrics {
  oeeToday: number | null;
  goodCountToday: number;
  scrapCountToday: number;
  energyTodayKwh: number;
  openAlarmCount: number;
}

function emptyMetrics(): MachineMetrics {
  return { oeeToday: null, goodCountToday: 0, scrapCountToday: 0, energyTodayKwh: 0, openAlarmCount: 0 };
}

@Injectable()
export class DigitalTwinService {
  constructor(private readonly prisma: PrismaService) {}

  /** 2D saha planı için tüm makineler (konum + canlı durum + atanmış iş emri +
   * bugünkü OEE/enerji + açık alarm sayısı) + bağlantılar. Faz I'de eklenen
   * runtimeHours/EnergyReading verisiyle birleşir — twin artık sadece konum
   * değil, makinenin o anki tam üretim durumunu da yansıtır. */
  async layout(tenantId: string) {
    const [machines, connections] = await Promise.all([
      this.prisma.machine.findMany({ where: { tenantId }, select: MACHINE_SELECT, orderBy: { name: "asc" } }),
      this.prisma.machineConnection.findMany({ where: { tenantId } }),
    ]);

    const metrics = await this.metricsByMachine(
      tenantId,
      machines.map((m) => m.id),
    );

    return {
      // runtimeHours Prisma Decimal'dır, JSON'a string olarak serileşir —
      // web tarafında sayı olarak kullanılabilmesi için burada dönüştürülür.
      machines: machines.map((m) => ({
        ...m,
        runtimeHours: Number(m.runtimeHours),
        ...(metrics.get(m.id) ?? emptyMetrics()),
      })),
      connections,
    };
  }

  /** Bugünkü OEE (quality×performance×availability), enerji tüketimi ve
   * AÇIK (acknowledgedAt=null) alarm sayısı — makine bazında. OeeService.trend()
   * ile aynı hesaplama mantığı, orada tarihe göre kovalanıyordu, burada tek bir
   * gün için makineye göre kovalanıyor. Açık alarm sayısı tarih sınırlı DEĞİL
   * (dünden kalan açık bir alarm hâlâ açıktır). */
  private async metricsByMachine(tenantId: string, machineIds: string[]): Promise<Map<string, MachineMetrics>> {
    if (machineIds.length === 0) return new Map();
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);

    const [runs, todaysEvents, energyReadings, openAlarms] = await Promise.all([
      this.prisma.productionRun.findMany({
        where: { tenantId, machineId: { in: machineIds }, startedAt: { gte: dayStart } },
        include: { workOrder: { include: { part: { select: { idealCycleTimeSec: true } } } } },
      }),
      this.prisma.machineStatusEvent.findMany({
        where: { tenantId, machineId: { in: machineIds }, occurredAt: { gte: dayStart } },
        orderBy: { occurredAt: "asc" },
      }),
      this.prisma.energyReading.groupBy({
        by: ["machineId"],
        where: { tenantId, machineId: { in: machineIds }, recordedAt: { gte: dayStart } },
        _sum: { kwh: true },
      }),
      this.prisma.machineStatusEvent.groupBy({
        by: ["machineId"],
        where: { tenantId, machineId: { in: machineIds }, type: "ALARM", acknowledgedAt: null },
        _count: { _all: true },
      }),
    ]);

    interface Bucket {
      goodCount: number;
      scrapCount: number;
      runtimeSeconds: number;
      idealSeconds: number;
      downtimeSeconds: number;
    }
    const buckets = new Map<string, Bucket>();
    const bucketFor = (id: string) => {
      let b = buckets.get(id);
      if (!b) {
        b = { goodCount: 0, scrapCount: 0, runtimeSeconds: 0, idealSeconds: 0, downtimeSeconds: 0 };
        buckets.set(id, b);
      }
      return b;
    };

    for (const run of runs) {
      if (!run.machineId) continue;
      const b = bucketFor(run.machineId);
      b.goodCount += run.goodCount;
      b.scrapCount += run.scrapCount;
      const end = run.endedAt ?? new Date();
      b.runtimeSeconds += Math.max(0, (end.getTime() - run.startedAt.getTime()) / 1000);
      const ideal = run.workOrder.part.idealCycleTimeSec ? Number(run.workOrder.part.idealCycleTimeSec) : null;
      if (ideal) b.idealSeconds += ideal * run.goodCount;
    }

    // Alarm süresi: aynı makinedeki bir ALARM olayından sıradaki olaya (yoksa
    // "şu an"a) kadar geçen süre — OeeService.alarmDurations ile aynı desen.
    const eventsByMachine = new Map<string, typeof todaysEvents>();
    for (const ev of todaysEvents) {
      const list = eventsByMachine.get(ev.machineId) ?? [];
      list.push(ev);
      eventsByMachine.set(ev.machineId, list);
    }
    for (const [machineId, list] of eventsByMachine) {
      for (let i = 0; i < list.length; i++) {
        if (list[i].type !== "ALARM") continue;
        const end = list[i + 1]?.occurredAt ?? new Date();
        bucketFor(machineId).downtimeSeconds += Math.max(
          0,
          (end.getTime() - list[i].occurredAt.getTime()) / 1000,
        );
      }
    }

    const energyByMachine = new Map(energyReadings.map((r) => [r.machineId, Number(r._sum.kwh ?? 0)]));
    const alarmCountByMachine = new Map(openAlarms.map((a) => [a.machineId, a._count._all]));

    const result = new Map<string, MachineMetrics>();
    for (const id of machineIds) {
      const b = buckets.get(id);
      let oeeToday: number | null = null;
      if (b) {
        const total = b.goodCount + b.scrapCount;
        const quality = total > 0 ? b.goodCount / total : null;
        const performance =
          b.idealSeconds > 0 && b.runtimeSeconds > 0 ? Math.min(1, b.idealSeconds / b.runtimeSeconds) : null;
        const availability =
          b.runtimeSeconds > 0 ? Math.max(0, Math.min(1, 1 - b.downtimeSeconds / b.runtimeSeconds)) : null;
        oeeToday =
          quality !== null && performance !== null && availability !== null
            ? quality * performance * availability
            : null;
      }
      result.set(id, {
        oeeToday,
        goodCountToday: b?.goodCount ?? 0,
        scrapCountToday: b?.scrapCount ?? 0,
        energyTodayKwh: energyByMachine.get(id) ?? 0,
        openAlarmCount: alarmCountByMachine.get(id) ?? 0,
      });
    }
    return result;
  }

  async setPosition(tenantId: string, machineId: string, dto: UpdateMachinePositionDto) {
    const machine = await this.prisma.machine.findFirst({ where: { id: machineId, tenantId } });
    if (!machine) throw new NotFoundException("Makine bulunamadı");
    return this.prisma.machine.update({
      where: { id: machineId },
      data: { posX: dto.posX, posY: dto.posY },
      select: MACHINE_SELECT,
    });
  }

  async createConnection(tenantId: string, dto: CreateMachineConnectionDto) {
    if (dto.fromMachineId === dto.toMachineId) {
      throw new ConflictException("Bir makine kendisine bağlanamaz");
    }
    const [from, to] = await Promise.all([
      this.prisma.machine.findFirst({ where: { id: dto.fromMachineId, tenantId } }),
      this.prisma.machine.findFirst({ where: { id: dto.toMachineId, tenantId } }),
    ]);
    if (!from || !to) throw new NotFoundException("Makine bulunamadı");
    try {
      return await this.prisma.machineConnection.create({
        data: { tenantId, fromMachineId: dto.fromMachineId, toMachineId: dto.toMachineId },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Bu bağlantı zaten var");
      }
      throw e;
    }
  }

  async removeConnection(tenantId: string, id: string) {
    const conn = await this.prisma.machineConnection.findFirst({ where: { id, tenantId } });
    if (!conn) throw new NotFoundException("Bağlantı bulunamadı");
    return this.prisma.machineConnection.delete({ where: { id } });
  }
}
