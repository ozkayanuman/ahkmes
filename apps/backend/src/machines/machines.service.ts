import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import type { Machine } from "@prisma/client";
import type {
  CreateMachineDto,
  MachineTelemetryDto,
  UpdateMachineDto,
} from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

const CONNECTOR_USER_EMAIL = "machine-connector@ahkmes.local";

@Injectable()
export class MachinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
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
      data: { ...dto, tenantId },
      select: MachinesService.PUBLIC_SELECT,
    });
  }

  async update(tenantId: string, id: string, dto: UpdateMachineDto) {
    await this.findOne(tenantId, id);
    return this.prisma.machine.update({
      where: { id },
      data: dto,
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

    if (dto.type === "CYCLE_START") {
      if (!machine.activeWorkOrderId) {
        throw new ConflictException("Tezgaha atanmış aktif iş emri yok");
      }
      const activeRun = await this.prisma.productionRun.findFirst({
        where: { tenantId, workOrderId: machine.activeWorkOrderId, endedAt: null },
      });
      if (!activeRun) {
        const wo = await this.prisma.workOrder.findFirst({
          where: { id: machine.activeWorkOrderId, tenantId },
        });
        if (!wo) throw new NotFoundException("İş emri bulunamadı");
        if (wo.status === "COMPLETED" || wo.status === "CANCELLED") {
          throw new ConflictException("Tamamlanmış/iptal edilmiş iş emrinde koşu başlatılamaz");
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
        await this.prisma.productionRun.update({
          where: { id: activeRun.id },
          data: { goodCount: { increment: 1 } },
        });
        this.realtime.emitToTenant(tenantId, "productionrun.updated", { id: activeRun.id });
      }
    }

    if (dto.type === "ALARM") {
      const message =
        typeof dto.payload?.message === "string" ? dto.payload.message : "Alarm";
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
          data: { downtimeNote: message },
        });
      }
      this.realtime.emitToTenant(tenantId, "machine.alarm", { machineId: machine.id, message });
    }

    await this.prisma.machine.update({
      where: { id: machine.id },
      data: { lastEventAt: new Date(), lastStatus: dto.type },
    });
    this.realtime.emitToTenant(tenantId, "machine.updated", { id: machine.id, status: dto.type });
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
