import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { WorkOrderStatus } from "@prisma/client";
import type { CreateWorkOrderDto, UpdateWorkOrderDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { nextDocNo } from "../common/numbering";

const TRANSITIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  PLANNED: ["WAITING_MATERIAL", "IN_PRODUCTION", "CANCELLED"],
  WAITING_MATERIAL: ["PLANNED", "IN_PRODUCTION", "CANCELLED"],
  IN_PRODUCTION: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

const WO_INCLUDE = {
  part: { select: { id: true, partNo: true, revision: true, name: true } },
  machine: { select: { id: true, name: true } },
  quoteLine: {
    select: {
      id: true,
      quote: {
        select: { id: true, quoteNo: true, customer: { select: { id: true, name: true } } },
      },
    },
  },
} as const;

@Injectable()
export class WorkOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  findAll(tenantId: string, status?: WorkOrderStatus, q?: string) {
    return this.prisma.workOrder.findMany({
      where: {
        tenantId,
        ...(status ? { status } : {}),
        ...(q
          ? {
              OR: [
                { woNo: { contains: q, mode: "insensitive" as const } },
                { part: { partNo: { contains: q, mode: "insensitive" as const } } },
                { part: { name: { contains: q, mode: "insensitive" as const } } },
              ],
            }
          : {}),
      },
      include: WO_INCLUDE,
      orderBy: [{ priority: "asc" }, { dueDate: "asc" }],
    });
  }

  async findOne(tenantId: string, id: string) {
    const wo = await this.prisma.workOrder.findFirst({
      where: { id, tenantId },
      include: WO_INCLUDE,
    });
    if (!wo) throw new NotFoundException("İş emri bulunamadı");
    return wo;
  }

  async create(tenantId: string, dto: CreateWorkOrderDto) {
    const part = await this.prisma.part.findFirst({ where: { id: dto.partId, tenantId } });
    if (!part) throw new NotFoundException("Parça bulunamadı");
    if (dto.machineId) await this.ensureMachine(tenantId, dto.machineId);

    const created = await this.prisma.$transaction(async (tx) => {
      const woNo = await nextDocNo(tx, "workOrder", "woNo", "IE");
      return tx.workOrder.create({
        data: { ...dto, tenantId, woNo },
        include: WO_INCLUDE,
      });
    });
    this.realtime.emitToTenant(tenantId, "workorder.updated", { id: created.id });
    return created;
  }

  async update(tenantId: string, id: string, dto: UpdateWorkOrderDto) {
    const wo = await this.findOne(tenantId, id);
    if (wo.status === "COMPLETED" || wo.status === "CANCELLED") {
      throw new ConflictException("Tamamlanmış/iptal edilmiş iş emri düzenlenemez");
    }
    if ((dto.quantity !== undefined || dto.dueDate !== undefined) && wo.status !== "PLANNED") {
      throw new ConflictException("Miktar ve termin sadece PLANNED durumunda değişebilir");
    }
    if (dto.machineId) await this.ensureMachine(tenantId, dto.machineId);

    const updated = await this.prisma.workOrder.update({
      where: { id },
      data: dto,
      include: WO_INCLUDE,
    });
    this.realtime.emitToTenant(tenantId, "workorder.updated", { id });
    return updated;
  }

  async setStatus(tenantId: string, id: string, status: WorkOrderStatus) {
    const wo = await this.findOne(tenantId, id);
    if (!TRANSITIONS[wo.status].includes(status)) {
      throw new ConflictException(`Geçersiz durum geçişi: ${wo.status} → ${status}`);
    }
    const updated = await this.prisma.workOrder.update({
      where: { id },
      data: { status },
      include: WO_INCLUDE,
    });
    this.realtime.emitToTenant(tenantId, "workorder.updated", { id, status });
    return updated;
  }

  async remove(tenantId: string, id: string) {
    const wo = await this.findOne(tenantId, id);
    if (wo.status !== "PLANNED" && wo.status !== "CANCELLED") {
      throw new ConflictException("Sadece PLANNED veya CANCELLED iş emri silinebilir");
    }
    const deleted = await this.prisma.workOrder.delete({ where: { id } });
    this.realtime.emitToTenant(tenantId, "workorder.updated", { id, deleted: true });
    return deleted;
  }

  private async ensureMachine(tenantId: string, machineId: string) {
    const machine = await this.prisma.machine.findFirst({
      where: { id: machineId, tenantId, isActive: true },
    });
    if (!machine) throw new NotFoundException("Tezgah bulunamadı veya pasif");
  }
}
