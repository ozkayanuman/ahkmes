import { ConflictException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import type { StartProductionRunDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { NonConformanceService } from "../non-conformance/non-conformance.service";
import { AppException } from "../common/app-exception";

interface UpdateRunInput {
  goodCount?: number;
  scrapCount?: number;
  downtimeNote?: string;
  notes?: string;
  completeWorkOrder?: boolean;
}

const RUN_INCLUDE = {
  workOrder: {
    select: {
      id: true,
      woNo: true,
      quantity: true,
      status: true,
      part: { select: { id: true, partNo: true, name: true } },
    },
  },
  machine: { select: { id: true, name: true } },
  operator: { select: { id: true, name: true } },
} as const;

@Injectable()
export class ProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly nonConformance: NonConformanceService,
  ) {}

  findAll(tenantId: string, workOrderId?: string, active?: boolean) {
    return this.prisma.productionRun.findMany({
      where: {
        tenantId,
        ...(workOrderId ? { workOrderId } : {}),
        ...(active ? { endedAt: null } : {}),
      },
      include: RUN_INCLUDE,
      orderBy: { startedAt: "desc" },
    });
  }

  /** Koşu başlat: iş emri IN_PRODUCTION'a çekilir; aynı iş emrinde ikinci aktif koşu 409. */
  async start(tenantId: string, operatorId: string, workOrderId: string, dto: StartProductionRunDto) {
    const created = await this.prisma.$transaction(async (tx) => {
      const wo = await tx.workOrder.findFirst({ where: { id: workOrderId, tenantId } });
      if (!wo) throw new NotFoundException("İş emri bulunamadı");
      if (wo.status === "COMPLETED" || wo.status === "CANCELLED") {
        throw new ConflictException("Tamamlanmış/iptal edilmiş iş emrinde koşu başlatılamaz");
      }
      const activeRun = await tx.productionRun.findFirst({
        where: { tenantId, workOrderId, endedAt: null },
      });
      if (activeRun) throw new ConflictException("Bu iş emrinde zaten aktif bir koşu var");
      if (dto.machineId) {
        const machine = await tx.machine.findFirst({
          where: { id: dto.machineId, tenantId, isActive: true },
        });
        if (!machine) throw new NotFoundException("Tezgah bulunamadı veya pasif");
      }

      const run = await tx.productionRun.create({
        data: {
          tenantId,
          workOrderId,
          machineId: dto.machineId,
          operatorId,
          notes: dto.notes,
          source: "MANUAL", // Faz 0: her zaman manuel giriş
        },
        include: RUN_INCLUDE,
      });
      if (wo.status !== "IN_PRODUCTION") {
        await tx.workOrder.update({ where: { id: workOrderId }, data: { status: "IN_PRODUCTION" } });
      }
      return run;
    });

    this.realtime.emitToTenant(tenantId, "productionrun.updated", { id: created.id });
    this.realtime.emitToTenant(tenantId, "workorder.updated", { id: workOrderId });
    return created;
  }

  async update(tenantId: string, id: string, dto: UpdateRunInput) {
    const run = await this.findOne(tenantId, id);
    if (run.endedAt) throw new ConflictException("Tamamlanmış koşu düzenlenemez");
    if (dto.goodCount !== undefined && (await this.nonConformance.hasOpenNonConformance(tenantId, run.workOrderId))) {
      throw new AppException(
        HttpStatus.CONFLICT,
        "NON_CONFORMANCE_OPEN",
        "Bu iş emrinde açık bir uygunsuzluk kaydı var — üretim adedi girişi engellendi",
      );
    }
    const updated = await this.prisma.productionRun.update({
      where: { id },
      data: dto,
      include: RUN_INCLUDE,
    });
    this.realtime.emitToTenant(tenantId, "productionrun.updated", { id });
    return updated;
  }

  /**
   * Koşuyu bitirir; adetler son kez güncellenebilir.
   * completeWorkOrder=false (varsayılan, "Parçalı Tamamla"): iş emri durumuna dokunmaz —
   * IN_PRODUCTION'da kalır, operatör ekranında "duraklatılmış" olarak görünür, sonra
   * yeni bir koşu ile devam edilebilir.
   * completeWorkOrder=true ("Tamamla"): iş emri de COMPLETED'a çekilir, hedef adede
   * ulaşılmamış olsa bile (makine kaynaklı otomatik tamamlamanın manuel karşılığı).
   */
  async complete(tenantId: string, id: string, dto: UpdateRunInput) {
    const run = await this.findOne(tenantId, id);
    if (run.endedAt) throw new ConflictException("Koşu zaten tamamlanmış");
    const { completeWorkOrder, ...runData } = dto;

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.productionRun.update({
        where: { id },
        data: { ...runData, endedAt: new Date() },
        include: RUN_INCLUDE,
      });
      if (completeWorkOrder) {
        await tx.workOrder.update({ where: { id: run.workOrderId }, data: { status: "COMPLETED" } });
        await tx.machine.updateMany({
          where: { tenantId, activeWorkOrderId: run.workOrderId },
          data: { activeWorkOrderId: null },
        });
      }
      return result;
    });

    this.realtime.emitToTenant(tenantId, "productionrun.updated", { id });
    if (completeWorkOrder) {
      this.realtime.emitToTenant(tenantId, "workorder.updated", { id: run.workOrderId, status: "COMPLETED" });
    }
    return updated;
  }

  private async findOne(tenantId: string, id: string) {
    const run = await this.prisma.productionRun.findFirst({ where: { id, tenantId } });
    if (!run) throw new NotFoundException("Üretim koşusu bulunamadı");
    return run;
  }
}
