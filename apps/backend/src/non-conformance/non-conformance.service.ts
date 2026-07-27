import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateNonConformanceDto, ResolveNonConformanceDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

const INCLUDE = {
  workOrder: { select: { id: true, woNo: true, status: true } },
  reportedBy: { select: { id: true, name: true } },
} as const;

@Injectable()
export class NonConformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  findAll(tenantId: string, workOrderId?: string, status?: string) {
    return this.prisma.nonConformance.findMany({
      where: { tenantId, ...(workOrderId ? { workOrderId } : {}), ...(status ? { status: status as never } : {}) },
      include: INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  /** Bir iş emrinde açık (OPEN) bir uygunsuzluk kaydı var mı — ProductionService bu kontrolü kullanır. */
  async hasOpenNonConformance(tenantId: string, workOrderId: string): Promise<boolean> {
    const open = await this.prisma.nonConformance.findFirst({
      where: { tenantId, workOrderId, status: "OPEN" },
    });
    return !!open;
  }

  async create(tenantId: string, reportedById: string, dto: CreateNonConformanceDto) {
    const wo = await this.prisma.workOrder.findFirst({ where: { id: dto.workOrderId, tenantId } });
    if (!wo) throw new NotFoundException("İş emri bulunamadı");

    const created = await this.prisma.nonConformance.create({
      data: { ...dto, tenantId, reportedById },
      include: INCLUDE,
    });
    this.realtime.emitToTenant(tenantId, "nonconformance.updated", { id: created.id, workOrderId: dto.workOrderId });
    return created;
  }

  async resolve(tenantId: string, id: string, dto: ResolveNonConformanceDto) {
    const nc = await this.prisma.nonConformance.findFirst({ where: { id, tenantId } });
    if (!nc) throw new NotFoundException("Uygunsuzluk kaydı bulunamadı");

    const updated = await this.prisma.nonConformance.update({
      where: { id },
      data: { status: dto.status, resolvedAt: dto.status === "RESOLVED" ? new Date() : null },
      include: INCLUDE,
    });
    this.realtime.emitToTenant(tenantId, "nonconformance.updated", { id, workOrderId: nc.workOrderId });
    return updated;
  }
}
