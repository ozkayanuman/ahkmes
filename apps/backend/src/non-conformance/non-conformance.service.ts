import { HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateNonConformanceDto, ResolveNonConformanceDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { OutboxService } from "../outbox/outbox.service";
import { AppException } from "../common/app-exception";
import { NotificationsService } from "../notifications/notifications.service";

const INCLUDE = {
  workOrder: { select: { id: true, woNo: true, status: true } },
  reportedBy: { select: { id: true, name: true } },
  resolvedBy: { select: { id: true, name: true } },
} as const;

@Injectable()
export class NonConformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly outbox: OutboxService,
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

    const created = await this.prisma.$transaction(async (tx) => {
      const nc = await tx.nonConformance.create({
        data: { ...dto, tenantId, reportedById },
        include: INCLUDE,
      });
      await this.outbox.record(tx, tenantId, "nonconformance", nc.id, "nonconformance.updated", { id: nc.id, workOrderId: dto.workOrderId });
      return nc;
    });
    await this.notifications.notifyRoles(tenantId, ["ADMIN", "FOREMAN"], {
      type: "NON_CONFORMANCE_CREATED",
      title: "Yeni uygunsuzluk bildirimi",
      message: `${wo.woNo}: ${dto.description ?? "Uygunsuzluk kaydı oluşturuldu"}`,
      entity: "non-conformances",
      entityId: created.id,
    });
    return created;
  }

  async resolve(tenantId: string, resolvedById: string, id: string, dto: ResolveNonConformanceDto) {
    const nc = await this.prisma.nonConformance.findFirst({ where: { id, tenantId } });
    if (!nc) throw new NotFoundException("Uygunsuzluk kaydı bulunamadı");
    if (dto.status === "RESOLVED" && !dto.resolutionNote?.trim()) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        "RESOLUTION_NOTE_REQUIRED",
        "Kaydı kapatmak için çözüm açıklaması (ne yapıldığı) girilmeli",
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.nonConformance.update({
        where: { id },
        data: {
          status: dto.status,
          resolvedAt: dto.status === "RESOLVED" ? new Date() : null,
          resolutionNote: dto.status === "RESOLVED" ? dto.resolutionNote : null,
          resolvedById: dto.status === "RESOLVED" ? resolvedById : null,
        },
        include: INCLUDE,
      });
      await this.outbox.record(tx, tenantId, "nonconformance", id, "nonconformance.updated", { id, workOrderId: nc.workOrderId });
      return result;
    });
    return updated;
  }
}
