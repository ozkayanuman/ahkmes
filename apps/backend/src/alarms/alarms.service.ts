import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CreateAlarmDefinitionDto, UpdateAlarmDefinitionDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

/**
 * Alarm Management (Faz F) — AlarmDefinition kataloğu (kod/önem derecesi standardizasyonu,
 * MachineStatusEvent'e hard FK ile bağlanmaz) + mevcut MachineStatusEvent(ALARM) kayıtları
 * üzerinde onay (acknowledge) işareti ve Pareto/frekans analizi.
 */
@Injectable()
export class AlarmsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  findDefinitions(tenantId: string, machineId?: string) {
    return this.prisma.alarmDefinition.findMany({
      where: { tenantId, ...(machineId ? { machineId } : {}) },
      include: { machine: { select: { id: true, name: true } } },
      orderBy: { code: "asc" },
    });
  }

  async createDefinition(tenantId: string, dto: CreateAlarmDefinitionDto) {
    if (dto.machineId) {
      const machine = await this.prisma.machine.findFirst({ where: { id: dto.machineId, tenantId } });
      if (!machine) throw new NotFoundException("Tezgah bulunamadı");
    }
    try {
      return await this.prisma.alarmDefinition.create({ data: { ...dto, tenantId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Bu alarm kodu zaten kayıtlı");
      }
      throw e;
    }
  }

  private async findDefinition(tenantId: string, id: string) {
    const def = await this.prisma.alarmDefinition.findFirst({ where: { id, tenantId } });
    if (!def) throw new NotFoundException("Alarm tanımı bulunamadı");
    return def;
  }

  async updateDefinition(tenantId: string, id: string, dto: UpdateAlarmDefinitionDto) {
    await this.findDefinition(tenantId, id);
    return this.prisma.alarmDefinition.update({ where: { id }, data: dto });
  }

  async removeDefinition(tenantId: string, id: string) {
    await this.findDefinition(tenantId, id);
    return this.prisma.alarmDefinition.delete({ where: { id } });
  }

  /** Onaylanmamış (acknowledgedAt=null) ALARM olayları — en yeni önce. */
  active(tenantId: string) {
    return this.prisma.machineStatusEvent.findMany({
      where: { tenantId, type: "ALARM", acknowledgedAt: null },
      include: { machine: { select: { id: true, name: true } } },
      orderBy: { occurredAt: "desc" },
    });
  }

  async acknowledge(tenantId: string, eventId: string, userId: string, note?: string) {
    const event = await this.prisma.machineStatusEvent.findFirst({ where: { id: eventId, tenantId } });
    if (!event) throw new NotFoundException("Alarm olayı bulunamadı");
    if (event.type !== "ALARM") throw new ConflictException("Sadece ALARM tipi olaylar onaylanabilir");
    if (event.acknowledgedAt) throw new ConflictException("Bu alarm zaten onaylanmış");

    const updated = await this.prisma.machineStatusEvent.update({
      where: { id: eventId },
      data: { acknowledgedById: userId, acknowledgedAt: new Date(), ackNote: note },
      include: { machine: { select: { id: true, name: true } } },
    });
    this.realtime.emitToTenant(tenantId, "alarm.acknowledged", { id: eventId, machineId: event.machineId });
    return updated;
  }

  /** Frekans/Pareto analizi: verilen periyotta ALARM mesajlarının tekrar sayısı, azalan sırada. */
  async pareto(tenantId: string, machineId?: string, from?: Date, to?: Date) {
    const events = await this.prisma.machineStatusEvent.findMany({
      where: {
        tenantId,
        type: "ALARM",
        ...(machineId ? { machineId } : {}),
        ...(from || to ? { occurredAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      },
      select: { message: true },
    });

    const counts = new Map<string, number>();
    for (const e of events) {
      const key = e.message ?? "Bilinmeyen alarm";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([message, count]) => ({ message, count }))
      .sort((a, b) => b.count - a.count);
  }
}
