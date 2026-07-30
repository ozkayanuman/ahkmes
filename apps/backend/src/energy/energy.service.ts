import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateEnergyReadingDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";

const READING_INCLUDE = {
  machine: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} as const;

function defaultRange() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 30);
  return { from, to };
}

function parseRange(fromRaw?: string, toRaw?: string) {
  const def = defaultRange();
  const from = fromRaw ? new Date(`${fromRaw}T00:00:00`) : def.from;
  const to = toRaw ? new Date(`${toRaw}T23:59:59`) : def.to;
  return {
    from: Number.isNaN(from.getTime()) ? def.from : from,
    to: Number.isNaN(to.getTime()) ? def.to : to,
  };
}

/** Faz I Energy Monitoring: manuel enerji tüketim kaydı — connector henüz kwh
 * telemetrisi göndermiyor, Calibration/SpcMeasurement'la aynı manuel giriş
 * deseni. Özet raporu ProductionRun.goodCount'la birleştirerek "üretilen parça
 * başına enerji" gibi bir verimlilik metriği de sunar (mevcut MES verisiyle
 * birleşir — Faz H'nin Labor Tracking'iyle aynı felsefe). */
@Injectable()
export class EnergyService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string, machineId?: string) {
    return this.prisma.energyReading.findMany({
      where: { tenantId, ...(machineId ? { machineId } : {}) },
      include: READING_INCLUDE,
      orderBy: { recordedAt: "desc" },
    });
  }

  async create(tenantId: string, userId: string, dto: CreateEnergyReadingDto) {
    const machine = await this.prisma.machine.findFirst({ where: { id: dto.machineId, tenantId } });
    if (!machine) throw new NotFoundException("Tezgah bulunamadı");

    return this.prisma.energyReading.create({
      data: {
        tenantId,
        machineId: dto.machineId,
        kwh: dto.kwh,
        recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : new Date(),
        notes: dto.notes,
        createdById: userId,
      },
      include: READING_INCLUDE,
    });
  }

  async remove(tenantId: string, id: string) {
    const reading = await this.prisma.energyReading.findFirst({ where: { id, tenantId } });
    if (!reading) throw new NotFoundException("Enerji kaydı bulunamadı");
    await this.prisma.energyReading.delete({ where: { id } });
    return { id };
  }

  /** Makine bazında toplam tüketim + aynı aralıktaki ProductionRun.goodCount'a
   * göre parça başına kwh (ideal cycle time'a benzer bir verimlilik göstergesi).
   * goodCount 0 ise kwhPerPart null döner (sahte bölme yapılmaz). */
  async summary(tenantId: string, fromRaw?: string, toRaw?: string) {
    const { from, to } = parseRange(fromRaw, toRaw);

    const readings = await this.prisma.energyReading.findMany({
      where: { tenantId, recordedAt: { gte: from, lte: to } },
      include: { machine: { select: { id: true, name: true } } },
    });
    const runs = await this.prisma.productionRun.findMany({
      where: { tenantId, machineId: { not: null }, startedAt: { gte: from, lte: to } },
      select: { machineId: true, goodCount: true },
    });

    const goodByMachine = new Map<string, number>();
    for (const r of runs) {
      if (!r.machineId) continue;
      goodByMachine.set(r.machineId, (goodByMachine.get(r.machineId) ?? 0) + r.goodCount);
    }

    const byMachine = new Map<
      string,
      { machineId: string; machineName: string; kwh: number; goodCount: number; kwhPerPart: number | null }
    >();
    for (const reading of readings) {
      const entry = byMachine.get(reading.machineId) ?? {
        machineId: reading.machineId,
        machineName: reading.machine.name,
        kwh: 0,
        goodCount: goodByMachine.get(reading.machineId) ?? 0,
        kwhPerPart: null,
      };
      entry.kwh += Number(reading.kwh);
      byMachine.set(reading.machineId, entry);
    }
    for (const entry of byMachine.values()) {
      entry.kwhPerPart = entry.goodCount > 0 ? entry.kwh / entry.goodCount : null;
    }

    const rows = [...byMachine.values()].sort((a, b) => b.kwh - a.kwh);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      machines: rows,
      totalKwh: rows.reduce((sum, r) => sum + r.kwh, 0),
    };
  }
}
