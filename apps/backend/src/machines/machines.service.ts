import { ConflictException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { Prisma as PrismaNS } from "@prisma/client";
import type { Machine, Prisma } from "@prisma/client";
import { AppException } from "../common/app-exception";
import type {
  CreateMachineDto,
  CreateMachineTagDto,
  MachineTagValuesDto,
  MachineTelemetryDto,
  UpdateMachineDto,
  UpdateMachineTagDto,
} from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { NotificationsService } from "../notifications/notifications.service";

const CONNECTOR_USER_EMAIL = "machine-connector@ahkmes.local";

@Injectable()
export class MachinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
  ) {}

  private static readonly PUBLIC_SELECT = {
    id: true,
    tenantId: true,
    name: true,
    model: true,
    controller: true,
    isActive: true,
    activeWorkOrderId: true,
    lastEventAt: true,
    lastStatus: true,
    connectorType: true,
    connectorConfig: true,
    unitId: true,
    runtimeHours: true,
    pmIntervalHours: true,
    lastPmRuntimeHours: true,
    hourlyRate: true,
    createdAt: true,
    updatedAt: true,
    activeWorkOrder: { select: { id: true, woNo: true, status: true } },
  } as const;

  findAll(tenantId: string) {
    return this.prisma.machine.findMany({
      where: { tenantId },
      orderBy: { name: "asc" },
      select: MachinesService.PUBLIC_SELECT,
    });
  }

  async findOne(tenantId: string, id: string) {
    const machine = await this.prisma.machine.findFirst({
      where: { id, tenantId },
      select: MachinesService.PUBLIC_SELECT,
    });
    if (!machine) throw new NotFoundException("Tezgah bulunamadı");
    return machine;
  }

  create(tenantId: string, dto: CreateMachineDto) {
    return this.prisma.machine.create({
      data: { ...dto, tenantId, connectorConfig: dto.connectorConfig as Prisma.InputJsonValue },
      select: MachinesService.PUBLIC_SELECT,
    });
  }

  async update(tenantId: string, id: string, dto: UpdateMachineDto) {
    await this.findOne(tenantId, id);
    return this.prisma.machine.update({
      where: { id },
      data: { ...dto, connectorConfig: dto.connectorConfig as Prisma.InputJsonValue },
      select: MachinesService.PUBLIC_SELECT,
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    // Tezgahlar silinmez, pasife alınır (iş emri geçmişi korunur)
    return this.prisma.machine.update({
      where: { id },
      data: { isActive: false },
      select: MachinesService.PUBLIC_SELECT,
    });
  }

  /** Ustabaşının "bu tezgahta şu an çalışan iş emri" ataması — connector CYCLE_START'ta bunu kullanır. */
  async assignActiveWorkOrder(tenantId: string, id: string, workOrderId: string | null) {
    await this.findOne(tenantId, id);
    if (workOrderId) {
      const wo = await this.prisma.workOrder.findFirst({ where: { id: workOrderId, tenantId } });
      if (!wo) throw new NotFoundException("İş emri bulunamadı");
      if (wo.status === "COMPLETED" || wo.status === "CANCELLED") {
        throw new ConflictException("Tamamlanmış/iptal edilmiş iş emri atanamaz");
      }
    }
    return this.prisma.machine.update({
      where: { id },
      data: { activeWorkOrderId: workOrderId },
      select: MachinesService.PUBLIC_SELECT,
    });
  }

  /** Düz metin anahtar yalnızca bu yanıtta döner; DB'de sadece bcrypt hash'i tutulur. */
  async generateConnectorKey(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    const plainKey = randomBytes(24).toString("hex");
    await this.prisma.machine.update({
      where: { id },
      data: { connectorKeyHash: await bcrypt.hash(plainKey, 10) },
    });
    return { key: plainKey };
  }

  /** MachineKeyGuard ile doğrulanmış makine üzerinden telemetri işleme (kullanıcı JWT'si yok). */
  async handleTelemetry(machine: Machine, dto: MachineTelemetryDto) {
    const tenantId = machine.tenantId;

    // İdempotency: connector'ın retry kuyruğu network hatasında aynı olayı iki kez
    // gönderirse, aynı (machineId, eventId) ikinci kez işlenmez. eventId verilmezse
    // (eski connector sürümü) dedup uygulanmaz — geriye uyumlu.
    if (dto.eventId) {
      try {
        await this.prisma.machineEventDedup.create({
          data: { tenantId, machineId: machine.id, eventId: dto.eventId },
        });
      } catch (err) {
        if (err instanceof PrismaNS.PrismaClientKnownRequestError && err.code === "P2002") {
          return { ok: true, duplicate: true };
        }
        throw err;
      }
    }

    if (dto.type === "CYCLE_START") {
      if (!machine.activeWorkOrderId) {
        throw new AppException(HttpStatus.CONFLICT, "NO_ACTIVE_WORK_ORDER", "Tezgaha atanmış aktif iş emri yok");
      }
      const activeRun = await this.prisma.productionRun.findFirst({
        where: { tenantId, workOrderId: machine.activeWorkOrderId, endedAt: null },
      });
      if (!activeRun) {
        const wo = await this.prisma.workOrder.findFirst({
          where: { id: machine.activeWorkOrderId, tenantId },
        });
        if (!wo) throw new AppException(HttpStatus.NOT_FOUND, "WORK_ORDER_NOT_FOUND", "İş emri bulunamadı");
        if (wo.status === "COMPLETED" || wo.status === "CANCELLED") {
          throw new AppException(
            HttpStatus.CONFLICT,
            "WORK_ORDER_CLOSED",
            "Tamamlanmış/iptal edilmiş iş emrinde koşu başlatılamaz",
          );
        }
        const operator = await this.connectorUser(tenantId);
        await this.prisma.$transaction(async (tx) => {
          await tx.productionRun.create({
            data: {
              tenantId,
              workOrderId: machine.activeWorkOrderId!,
              machineId: machine.id,
              operatorId: operator.id,
              source: "MACHINE",
            },
          });
          if (wo.status !== "IN_PRODUCTION") {
            await tx.workOrder.update({ where: { id: wo.id }, data: { status: "IN_PRODUCTION" } });
          }
        });
        this.realtime.emitToTenant(tenantId, "productionrun.updated", { machineId: machine.id });
        this.realtime.emitToTenant(tenantId, "workorder.updated", { id: wo.id });
      }
    }

    if (dto.type === "PART_COMPLETE" && machine.activeWorkOrderId) {
      const activeRun = await this.prisma.productionRun.findFirst({
        where: {
          tenantId,
          workOrderId: machine.activeWorkOrderId,
          machineId: machine.id,
          endedAt: null,
          source: "MACHINE",
        },
      });
      if (activeRun) {
        const wo = await this.prisma.workOrder.findFirst({
          where: { id: machine.activeWorkOrderId, tenantId },
        });
        const newGoodCount = activeRun.goodCount + 1;
        // Hedef adede ulaşılınca koşu/iş emri otomatik biter; tezgahın aktif iş
        // emri temizlenir (ustabaşı yeni bir iş emri atayana kadar bekler).
        const targetReached = !!wo && newGoodCount >= Number(wo.quantity);

        await this.prisma.$transaction(async (tx) => {
          await tx.productionRun.update({
            where: { id: activeRun.id },
            data: { goodCount: { increment: 1 }, ...(targetReached ? { endedAt: new Date() } : {}) },
          });
          if (targetReached) {
            await tx.workOrder.update({
              where: { id: machine.activeWorkOrderId! },
              data: { status: "COMPLETED" },
            });
            await tx.machine.update({ where: { id: machine.id }, data: { activeWorkOrderId: null } });
          }
        });

        this.realtime.emitToTenant(tenantId, "productionrun.updated", { id: activeRun.id });
        if (targetReached) {
          this.realtime.emitToTenant(tenantId, "workorder.updated", {
            id: machine.activeWorkOrderId,
            status: "COMPLETED",
          });
        }
      }
    }

    let alarmMessage: string | null = null;
    if (dto.type === "ALARM") {
      alarmMessage = typeof dto.payload?.message === "string" ? dto.payload.message : "Alarm";
      const activeRun = await this.prisma.productionRun.findFirst({
        where: {
          tenantId,
          machineId: machine.id,
          endedAt: null,
          source: "MACHINE",
        },
      });
      if (activeRun) {
        await this.prisma.productionRun.update({
          where: { id: activeRun.id },
          data: { downtimeNote: alarmMessage },
        });
      }
      this.realtime.emitToTenant(tenantId, "machine.alarm", { machineId: machine.id, message: alarmMessage });
      await this.notifications.notifyRoles(tenantId, ["ADMIN", "FOREMAN"], {
        type: "MACHINE_ALARM",
        title: "Makine alarmı",
        message: `${machine.name}: ${alarmMessage}`,
        entity: "machines",
        entityId: machine.id,
      });
    }

    // OEE trend/duruş (downtime) Pareto analizi bu geçmişten türetilir — her telemetri
    // olayı zaman damgasıyla kalıcı olarak kaydedilir (bkz. oee/oee.service.ts).
    await this.prisma.machineStatusEvent.create({
      data: {
        tenantId,
        machineId: machine.id,
        type: dto.type,
        message: alarmMessage,
        workOrderId: machine.activeWorkOrderId,
      },
    });

    await this.prisma.machine.update({
      where: { id: machine.id },
      data: { lastEventAt: new Date(), lastStatus: dto.type },
    });
    this.realtime.emitToTenant(tenantId, "machine.updated", { id: machine.id, status: dto.type });
    return { ok: true };
  }

  /** MachineKeyGuard ile doğrulanmış makine — connector'ın toplu tag değeri gönderdiği uç nokta. */
  async handleTagValues(machine: Machine, dto: MachineTagValuesDto) {
    const tenantId = machine.tenantId;
    const applied: { tagName: string; value: string; timestamp: string }[] = [];

    for (const v of dto.values) {
      const tag = await this.prisma.machineTag.findFirst({
        where: { tenantId, machineId: machine.id, name: v.tagName },
      });
      if (!tag) continue; // Tanımsız tag adı sessizce atlanır — tag'ler ayrı CRUD ile tanımlanır.
      const timestamp = (v.timestamp ?? new Date()).toISOString();
      await this.prisma.machineTag.update({
        where: { id: tag.id },
        data: { lastValue: v.value, lastValueAt: timestamp },
      });
      applied.push({ tagName: v.tagName, value: v.value, timestamp });
    }

    if (applied.length > 0) {
      this.realtime.emitToTenant(tenantId, "tag.value.updated", { machineId: machine.id, values: applied });
    }
    return { ok: true, applied: applied.length };
  }

  // ---- Automation Gateway: Machine Tag CRUD (Faz 1) ----

  async listTags(tenantId: string, machineId: string) {
    await this.findOne(tenantId, machineId);
    return this.prisma.machineTag.findMany({
      where: { tenantId, machineId },
      orderBy: { name: "asc" },
    });
  }

  async createTag(tenantId: string, machineId: string, dto: CreateMachineTagDto) {
    await this.findOne(tenantId, machineId);
    const existing = await this.prisma.machineTag.findFirst({
      where: { tenantId, machineId, name: dto.name },
    });
    if (existing) throw new ConflictException("Bu isimde bir tag zaten var");
    return this.prisma.machineTag.create({ data: { ...dto, tenantId, machineId } });
  }

  private async findTag(tenantId: string, machineId: string, tagId: string) {
    const tag = await this.prisma.machineTag.findFirst({
      where: { id: tagId, tenantId, machineId },
    });
    if (!tag) throw new NotFoundException("Tag bulunamadı");
    return tag;
  }

  async updateTag(tenantId: string, machineId: string, tagId: string, dto: UpdateMachineTagDto) {
    await this.findTag(tenantId, machineId, tagId);
    return this.prisma.machineTag.update({ where: { id: tagId }, data: dto });
  }

  async removeTag(tenantId: string, machineId: string, tagId: string) {
    await this.findTag(tenantId, machineId, tagId);
    await this.prisma.machineTag.delete({ where: { id: tagId } });
    return { ok: true };
  }

  private async connectorUser(tenantId: string) {
    const user = await this.prisma.user.findFirst({
      where: { tenantId, email: CONNECTOR_USER_EMAIL },
    });
    if (!user) throw new NotFoundException("Makine bağlantısı sistem kullanıcısı bulunamadı (seed çalıştırılmalı)");
    return user;
  }
}
