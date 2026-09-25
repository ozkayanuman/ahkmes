import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CreateSpcCharacteristicDto, CreateSpcMeasurementDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { OutboxService } from "../outbox/outbox.service";
import { NonConformanceService } from "../non-conformance/non-conformance.service";

const CHAR_INCLUDE = {
  part: { select: { id: true, partNo: true, name: true } },
} as const;

const MEASUREMENT_INCLUDE = {
  measuredBy: { select: { id: true, name: true } },
  workOrder: { select: { id: true, woNo: true } },
} as const;

/**
 * SPC (İstatistiksel Süreç Kontrolü) — karakteristik tanımı (tolerans limitleri) +
 * ölçüm kaydı. Limit dışı (out-of-spec) ölçüm, Inspection'ın FAIL sonucunda yaptığı
 * çapraz-modül çağrı deseniyle tutarlı şekilde otomatik NonConformance üretir.
 */
@Injectable()
export class SpcService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly nonConformance: NonConformanceService,
    private readonly outbox: OutboxService,
  ) {}

  findCharacteristics(tenantId: string, partId?: string) {
    return this.prisma.spcCharacteristic.findMany({
      where: { tenantId, ...(partId ? { partId } : {}) },
      include: CHAR_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  async findCharacteristic(tenantId: string, id: string) {
    const c = await this.prisma.spcCharacteristic.findFirst({ where: { id, tenantId }, include: CHAR_INCLUDE });
    if (!c) throw new NotFoundException("SPC karakteristiği bulunamadı");
    return c;
  }

  async createCharacteristic(tenantId: string, dto: CreateSpcCharacteristicDto) {
    const part = await this.prisma.part.findFirst({ where: { id: dto.partId, tenantId } });
    if (!part) throw new NotFoundException("Parça bulunamadı");
    return this.prisma.spcCharacteristic.create({ data: { ...dto, tenantId }, include: CHAR_INCLUDE });
  }

  async removeCharacteristic(tenantId: string, id: string) {
    await this.findCharacteristic(tenantId, id);
    return this.prisma.spcCharacteristic.delete({ where: { id } });
  }

  findMeasurements(tenantId: string, characteristicId: string) {
    return this.prisma.spcMeasurement.findMany({
      where: { tenantId, characteristicId },
      include: MEASUREMENT_INCLUDE,
      orderBy: { measuredAt: "desc" },
    });
  }

  /**
   * Ölçüm kaydı — karakteristikte USL/LSL tanımlıysa spec-dışı kontrolü yapılır
   * (ikisi de tanımlı değilse inSpec null kalır, sahte sonuç üretilmez). Spec-dışı
   * ölçüm otomatik olarak bir NonConformance açar.
   */
  async recordMeasurement(tenantId: string, userId: string, dto: CreateSpcMeasurementDto) {
    const characteristic = await this.findCharacteristic(tenantId, dto.characteristicId);
    if (dto.workOrderId) {
      const wo = await this.prisma.workOrder.findFirst({ where: { id: dto.workOrderId, tenantId } });
      if (!wo) throw new NotFoundException("İş emri bulunamadı");
    }

    const value = new Prisma.Decimal(dto.value);
    const usl = characteristic.uslUpper ? new Prisma.Decimal(characteristic.uslUpper) : null;
    const lsl = characteristic.lslLower ? new Prisma.Decimal(characteristic.lslLower) : null;
    const inSpec = usl === null && lsl === null ? null : (usl === null || value.lte(usl)) && (lsl === null || value.gte(lsl));

    const created = await this.prisma.$transaction(async (tx) => {
      const measurement = await tx.spcMeasurement.create({
        data: {
          tenantId,
          characteristicId: dto.characteristicId,
          workOrderId: dto.workOrderId,
          value,
          inSpec,
          measuredById: userId,
          measuredAt: dto.measuredAt ?? new Date(),
        },
        include: MEASUREMENT_INCLUDE,
      });
      await this.outbox.record(tx, tenantId, "spc", measurement.id, "spc.measurement.created", {
        characteristicId: dto.characteristicId,
        inSpec,
      });
      return measurement;
    });

    if (inSpec === false && dto.workOrderId) {
      await this.nonConformance.create(tenantId, userId, {
        workOrderId: dto.workOrderId,
        failureType: `SPC limit dışı: ${characteristic.name}`,
        description: `Ölçüm: ${dto.value}${characteristic.unit ? ` ${characteristic.unit}` : ""} (LSL: ${characteristic.lslLower ?? "-"}, USL: ${characteristic.uslUpper ?? "-"})`,
        actionType: "GENERIC",
      });
    }

    return created;
  }

  /**
   * Cp/Cpk hesaplaması — en az 2 ölçüm ve hem USL hem LSL tanımlı olmalı, aksi halde
   * null döner (sahte sayı üretilmez). Örneklem standart sapması (n-1) kullanılır.
   */
  async stats(tenantId: string, characteristicId: string) {
    const characteristic = await this.findCharacteristic(tenantId, characteristicId);
    const measurements = await this.prisma.spcMeasurement.findMany({
      where: { tenantId, characteristicId },
      select: { value: true },
    });

    const values = measurements.map((m) => Number(m.value));
    const n = values.length;
    const mean = n > 0 ? values.reduce((a, b) => a + b, 0) / n : null;
    const stddev =
      n > 1 && mean !== null
        ? Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1))
        : null;

    const usl = characteristic.uslUpper ? Number(characteristic.uslUpper) : null;
    const lsl = characteristic.lslLower ? Number(characteristic.lslLower) : null;

    let cp: number | null = null;
    let cpk: number | null = null;
    if (stddev !== null && stddev > 0 && usl !== null && lsl !== null && mean !== null) {
      cp = (usl - lsl) / (6 * stddev);
      cpk = Math.min(usl - mean, mean - lsl) / (3 * stddev);
    }

    return {
      characteristicId,
      sampleSize: n,
      mean,
      stddev,
      cp,
      cpk,
      note:
        n < 2
          ? "Cp/Cpk hesaplanamadı: en az 2 ölçüm gerekli."
          : usl === null || lsl === null
            ? "Cp/Cpk hesaplanamadı: karakteristikte USL ve LSL tanımlı değil."
            : undefined,
    };
  }

  /**
   * Kontrol grafiği (Individuals/Moving-Range) + Nelson'ın 8 kuralı. UCL/LCL,
   * USL/LSL (spec limitleri) DEĞİL — sürecin kendi ortalama/sapmasından
   * hesaplanan istatistiksel kontrol limitleridir; ikisi kavramsal olarak
   * ayrıdır (bir süreç spec içinde olup yine de kontrol dışı olabilir).
   * En az 8 ölçüm gerekir (Nelson kural 8, 8 ardışık nokta ister); azsa
   * sadece merkez hattı/limitler hesaplanmadan boş ihlal listesiyle döner.
   */
  async controlChart(tenantId: string, characteristicId: string) {
    await this.findCharacteristic(tenantId, characteristicId);
    const rows = await this.prisma.spcMeasurement.findMany({
      where: { tenantId, characteristicId },
      select: { id: true, value: true, measuredAt: true },
      orderBy: { measuredAt: "asc" },
    });

    const points = rows.map((r) => ({ measurementId: r.id, measuredAt: r.measuredAt, value: Number(r.value) }));
    const n = points.length;
    if (n < 8) {
      return {
        characteristicId,
        sampleSize: n,
        centerLine: null,
        ucl: null,
        lcl: null,
        sigma: null,
        points,
        violations: [] as ControlChartViolation[],
        note: "Kontrol grafiği için en az 8 ölçüm gerekli (Nelson kural 8).",
      };
    }

    const values = points.map((p) => p.value);
    const centerLine = values.reduce((a, b) => a + b, 0) / n;
    const movingRanges = values.slice(1).map((v, i) => Math.abs(v - values[i]));
    const mrBar = movingRanges.reduce((a, b) => a + b, 0) / movingRanges.length;
    // I-MR sabitleri: d2=1.128 (n=2 alt grup), 3-sigma = 2.66 * MRbar
    const sigma = mrBar / 1.128;
    const ucl = centerLine + 3 * sigma;
    const lcl = centerLine - 3 * sigma;

    const violations = sigma > 0 ? detectNelsonViolations(points, centerLine, sigma) : [];

    return { characteristicId, sampleSize: n, centerLine, ucl, lcl, sigma, points, violations };
  }
}

export interface ControlChartPoint {
  measurementId: string;
  measuredAt: Date;
  value: number;
}

export interface ControlChartViolation {
  measurementId: string;
  rule: number;
  description: string;
}

/** Bir noktanın merkez hattına göre bölgesi: zon sınırı kaçıncı sigma'da. 4 = 3-sigma'yı aşan. */
function zoneOf(point: number, centerLine: number, sigma: number): number {
  const distance = Math.abs(point - centerLine) / sigma;
  if (distance > 3) return 4;
  if (distance > 2) return 3;
  if (distance > 1) return 2;
  return 1;
}

function detectNelsonViolations(
  points: ControlChartPoint[],
  centerLine: number,
  sigma: number,
): ControlChartViolation[] {
  const violations: ControlChartViolation[] = [];
  const values = points.map((p) => p.value);
  const side = values.map((v) => (v >= centerLine ? 1 : -1));
  const zone = values.map((v) => zoneOf(v, centerLine, sigma));

  const push = (i: number, rule: number, description: string) =>
    violations.push({ measurementId: points[i].measurementId, rule, description });

  for (let i = 0; i < values.length; i++) {
    // Kural 1: tek nokta 3-sigma dışında
    if (zone[i] === 4) push(i, 1, "Tek nokta kontrol limitlerinin (3-sigma) dışında");

    // Kural 2: 9 ardışık nokta merkez hattının aynı tarafında
    if (i >= 8) {
      const window = side.slice(i - 8, i + 1);
      if (window.every((s) => s === window[0])) push(i, 2, "9 ardışık nokta merkez hattının aynı tarafında");
    }

    // Kural 3: 6 ardışık nokta sürekli artan veya azalan
    if (i >= 5) {
      const window = values.slice(i - 5, i + 1);
      const increasing = window.every((v, idx) => idx === 0 || v > window[idx - 1]);
      const decreasing = window.every((v, idx) => idx === 0 || v < window[idx - 1]);
      if (increasing || decreasing) push(i, 3, "6 ardışık nokta sürekli artıyor veya azalıyor (trend)");
    }

    // Kural 4: 14 ardışık nokta yön değiştirerek salınıyor
    if (i >= 13) {
      const window = values.slice(i - 13, i + 1);
      let alternating = true;
      for (let idx = 2; idx < window.length; idx++) {
        const prevDir = window[idx - 1] - window[idx - 2];
        const dir = window[idx] - window[idx - 1];
        if (prevDir === 0 || dir === 0 || Math.sign(prevDir) === Math.sign(dir)) {
          alternating = false;
          break;
        }
      }
      if (alternating) push(i, 4, "14 ardışık nokta yön değiştirerek salınıyor");
    }

    // Kural 5: son 3 noktadan 2'si aynı tarafta 2-sigma dışında (zon A veya ötesi)
    if (i >= 2) {
      const windowIdx = [i - 2, i - 1, i];
      for (const s of [1, -1]) {
        const beyond2Sigma = windowIdx.filter((idx) => side[idx] === s && zone[idx] >= 3);
        if (beyond2Sigma.length >= 2) {
          push(i, 5, "Son 3 noktadan 2'si aynı tarafta 2-sigma dışında");
          break;
        }
      }
    }

    // Kural 6: son 5 noktadan 4'ü aynı tarafta 1-sigma dışında (zon B veya ötesi)
    if (i >= 4) {
      const windowIdx = [i - 4, i - 3, i - 2, i - 1, i];
      for (const s of [1, -1]) {
        const beyond1Sigma = windowIdx.filter((idx) => side[idx] === s && zone[idx] >= 2);
        if (beyond1Sigma.length >= 4) {
          push(i, 6, "Son 5 noktadan 4'ü aynı tarafta 1-sigma dışında");
          break;
        }
      }
    }

    // Kural 7: 15 ardışık nokta 1-sigma içinde (her iki tarafta da, düşük varyasyon)
    if (i >= 14) {
      const window = zone.slice(i - 14, i + 1);
      if (window.every((z) => z === 1)) push(i, 7, "15 ardışık nokta 1-sigma içinde (anormal düşük varyasyon)");
    }

    // Kural 8: 8 ardışık nokta 1-sigma dışında, her iki tarafta da olabilir
    if (i >= 7) {
      const window = zone.slice(i - 7, i + 1);
      if (window.every((z) => z >= 2)) push(i, 8, "8 ardışık nokta 1-sigma dışında (her iki tarafta da olabilir)");
    }
  }

  return violations;
}
