import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { MaintenanceOrderStatus } from "@prisma/client";
import type { CompleteMaintenanceOrderDto, CreateMaintenanceOrderDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { nextDocNo } from "../common/numbering";

// PLANNED → IN_PROGRESS | CANCELLED; IN_PROGRESS → COMPLETED | CANCELLED
const TRANSITIONS: Record<MaintenanceOrderStatus, MaintenanceOrderStatus[]> = {
  PLANNED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

const MO_INCLUDE = {
  machine: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} as const;

/** Bakım emri (PM/CM) — Faz E MVP'de TAKVİM BAZLI (scheduledDate).
 * Machine'de kümülatif çalışma saati sayacı olmadığından runtime-hour bazlı
 * tetikleme bilinçli olarak kapsam dışı (bkz. schema.prisma yorumu). */
@Injectable()
export class MaintenanceOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  findAll(tenantId: string, machineId?: string, status?: MaintenanceOrderStatus) {
    return this.prisma.maintenanceOrder.findMany({
      where: { tenantId, ...(machineId ? { machineId } : {}), ...(status ? { status } : {}) },
      include: MO_INCLUDE,
      orderBy: { scheduledDate: "asc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const mo = await this.prisma.maintenanceOrder.findFirst({ where: { id, tenantId }, include: MO_INCLUDE });
    if (!mo) throw new NotFoundException("Bakım emri bulunamadı");
    return mo;
  }

  async create(tenantId: string, userId: string, dto: CreateMaintenanceOrderDto) {
    const machine = await this.prisma.machine.findFirst({ where: { id: dto.machineId, tenantId } });
    if (!machine) throw new NotFoundException("Makine bulunamadı");

    const created = await this.prisma.$transaction(async (tx) => {
      const bakNo = await nextDocNo(tx, "maintenanceOrder", "bakNo", "BAK");
      return tx.maintenanceOrder.create({
        data: { ...dto, tenantId, bakNo, createdById: userId },
        include: MO_INCLUDE,
      });
    });
    this.realtime.emitToTenant(tenantId, "maintenanceorder.updated", { id: created.id });
    return created;
  }

  async setStatus(tenantId: string, id: string, status: MaintenanceOrderStatus) {
    const mo = await this.findOne(tenantId, id);
    if (!TRANSITIONS[mo.status].includes(status)) {
      throw new ConflictException(`Geçersiz durum geçişi: ${mo.status} → ${status}`);
    }
    const updated = await this.prisma.maintenanceOrder.update({
      where: { id },
      data: { status },
      include: MO_INCLUDE,
    });
    this.realtime.emitToTenant(tenantId, "maintenanceorder.updated", { id, status });
    return updated;
  }

  async complete(tenantId: string, id: string, dto: CompleteMaintenanceOrderDto) {
    const mo = await this.findOne(tenantId, id);
    if (!TRANSITIONS[mo.status].includes("COMPLETED")) {
      throw new ConflictException(`Geçersiz durum geçişi: ${mo.status} → COMPLETED`);
    }
    const updated = await this.prisma.maintenanceOrder.update({
      where: { id },
      data: { status: "COMPLETED", completedAt: new Date(), notes: dto.notes ?? mo.notes },
      include: MO_INCLUDE,
    });
    this.realtime.emitToTenant(tenantId, "maintenanceorder.updated", { id, status: "COMPLETED" });
    return updated;
  }
}
