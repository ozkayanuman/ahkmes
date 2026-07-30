import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CreateSpcCharacteristicDto, CreateSpcMeasurementDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
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
    private readonly realtime: RealtimeGateway,
    private readonly nonConformance: NonConformanceService,
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

    const created = await this.prisma.spcMeasurement.create({
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

    if (inSpec === false && dto.workOrderId) {
      await this.nonConformance.create(tenantId, userId, {
        workOrderId: dto.workOrderId,
        failureType: `SPC limit dışı: ${characteristic.name}`,
        description: `Ölçüm: ${dto.value}${characteristic.unit ? ` ${characteristic.unit}` : ""} (LSL: ${characteristic.lslLower ?? "-"}, USL: ${characteristic.uslUpper ?? "-"})`,
        actionType: "GENERIC",
      });
    }

    this.realtime.emitToTenant(tenantId, "spc.measurement.created", {
      characteristicId: dto.characteristicId,
      inSpec,
    });
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
}
