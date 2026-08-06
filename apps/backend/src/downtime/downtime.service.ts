import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  ClassifyDowntimeDto,
  CreateDowntimeReasonDto,
  EndDowntimeDto,
  UpdateDowntimeReasonDto,
} from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { OutboxService } from "../outbox/outbox.service";

interface StartInput {
  reasonId?: string;
  note?: string;
  source: "ALARM" | "MANUAL";
  triggeredById?: string;
}

/**
 * Downtime/Andon taksonomisi — AlarmDefinition ile aynı desende tenant-scoped
 * bir duruş nedeni kataloğu (DowntimeReason) ve MachineStatusEvent(ALARM)'dan
 * bağımsız, açık/kapalı yaşam döngüsü olan yapılandırılmış duruş kayıtları
 * (DowntimeEvent). ALARM telemetrisi (machines.service.ts#handleTelemetry)
 * otomatik açar/kapatır; operatör/ustabaşı POST /downtime/start ile elle de
 * açabilir (Andon çağrısı). AHK-009 outbox'ı kullanır — "duruş başladı/bitti"
 * sinyali domain yazımıyla AYNI transaction'da kaydedilir, dispatcher onu
 * ayrı bir worker'da en-az-bir-kez tüketip emitToTenant'a çevirir.
 */
@Injectable()
export class DowntimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  findReasons(tenantId: string) {
    return this.prisma.downtimeReason.findMany({ where: { tenantId }, orderBy: { code: "asc" } });
  }

  async createReason(tenantId: string, dto: CreateDowntimeReasonDto) {
    try {
      return await this.prisma.downtimeReason.create({ data: { ...dto, tenantId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Bu duruş kodu zaten kayıtlı");
      }
      throw e;
    }
  }

  private async findReason(tenantId: string, id: string) {
    const reason = await this.prisma.downtimeReason.findFirst({ where: { id, tenantId } });
    if (!reason) throw new NotFoundException("Duruş nedeni bulunamadı");
    return reason;
  }

  async updateReason(tenantId: string, id: string, dto: UpdateDowntimeReasonDto) {
    await this.findReason(tenantId, id);
    return this.prisma.downtimeReason.update({ where: { id }, data: dto });
  }

  private async findEvent(tenantId: string, id: string) {
    const event = await this.prisma.downtimeEvent.findFirst({ where: { id, tenantId } });
    if (!event) throw new NotFoundException("Duruş kaydı bulunamadı");
    return event;
  }

  list(tenantId: string, machineId?: string, open?: boolean) {
    return this.prisma.downtimeEvent.findMany({
      where: {
        tenantId,
        ...(machineId ? { machineId } : {}),
        ...(open !== undefined ? { endedAt: open ? null : { not: null } } : {}),
      },
      include: { reason: true, machine: { select: { id: true, name: true } } },
      orderBy: { startedAt: "desc" },
      take: 200,
    });
  }

  /** ALARM telemetrisi VE elle Andon çağrısı aynı yoldan geçer. Bir makinede
   * aynı anda birden çok AÇIK duruş kaydı olamaz — ALARM zaten açık bir kayıt
   * varsa (art arda alarm) yenisini AÇMAZ, mevcut kaydı döner (idempotent);
   * elle çağrıda bu durum ConflictException'dır (operatör devam eden bir
   * duruşu bilerek yeniden başlatmamalı). */
  async start(tenantId: string, machineId: string, input: StartInput) {
    const machine = await this.prisma.machine.findFirst({ where: { id: machineId, tenantId } });
    if (!machine) throw new NotFoundException("Tezgah bulunamadı");
    if (input.reasonId) await this.findReason(tenantId, input.reasonId);

    const existing = await this.prisma.downtimeEvent.findFirst({ where: { tenantId, machineId, endedAt: null } });
    if (existing) {
      if (input.source === "MANUAL") throw new ConflictException("Bu tezgahta zaten açık bir duruş kaydı var");
      return existing;
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.downtimeEvent.create({
        data: {
          tenantId,
          machineId,
          reasonId: input.reasonId,
          note: input.note,
          source: input.source,
          triggeredById: input.triggeredById,
          workOrderId: machine.activeWorkOrderId,
        },
      });
      await this.outbox.record(tx, tenantId, "downtime", created.id, "downtime.started", {
        id: created.id,
        machineId,
        source: input.source,
      });
      return created;
    });
  }

  async classify(tenantId: string, id: string, dto: ClassifyDowntimeDto) {
    await this.findEvent(tenantId, id);
    await this.findReason(tenantId, dto.reasonId);
    return this.prisma.downtimeEvent.update({ where: { id }, data: { reasonId: dto.reasonId } });
  }

  async end(tenantId: string, id: string, closedById: string, dto: EndDowntimeDto) {
    const event = await this.findEvent(tenantId, id);
    if (event.endedAt) throw new ConflictException("Bu duruş kaydı zaten kapatılmış");
    if (dto.reasonId) await this.findReason(tenantId, dto.reasonId);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.downtimeEvent.update({
        where: { id },
        data: {
          endedAt: new Date(),
          closedById,
          closedAt: new Date(),
          ...(dto.reasonId ? { reasonId: dto.reasonId } : {}),
          ...(dto.note ? { note: dto.note } : {}),
        },
      });
      await this.outbox.record(tx, tenantId, "downtime", id, "downtime.ended", { id, machineId: event.machineId });
      return updated;
    });
  }

  /** Telemetri akışında (CYCLE_START/PART_COMPLETE/IDLE) makine "üretime
   * döndü" sinyali verince otomatik kapatır — kimse elle kapatmamışsa
   * reasonId null kalır, sonradan classify() ile sınıflandırılabilir. */
  async autoCloseOnResume(tenantId: string, machineId: string) {
    const open = await this.prisma.downtimeEvent.findFirst({ where: { tenantId, machineId, endedAt: null } });
    if (!open) return null;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.downtimeEvent.update({ where: { id: open.id }, data: { endedAt: new Date() } });
      await this.outbox.record(tx, tenantId, "downtime", open.id, "downtime.ended", { id: open.id, machineId });
      return updated;
    });
  }
}
