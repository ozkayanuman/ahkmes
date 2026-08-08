import { ConflictException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { StartProductionRunDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { OutboxService } from "../outbox/outbox.service";
import { NonConformanceService } from "../non-conformance/non-conformance.service";
import { AppException } from "../common/app-exception";
import { PartsService } from "../parts/parts.service";
import { ToolingService } from "../tooling/tooling.service";

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
  operation: { select: { id: true, seq: true, name: true, status: true } },
} as const;

@Injectable()
export class ProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly nonConformance: NonConformanceService,
    private readonly outbox: OutboxService,
    private readonly parts?: PartsService,
    private readonly tooling?: ToolingService,
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
      const routeOperations = await tx.workOrderOperation.findMany({
        where: { tenantId, workOrderId },
        orderBy: { seq: "asc" },
      });
      let operationId: string | undefined;
      let assignedMachineId = dto.machineId ?? wo.machineId ?? undefined;
      if (routeOperations.length > 0) {
        if (!dto.operationId) throw new ConflictException("Rotalı iş emrinde başlatılacak operasyon seçilmelidir");
        const operation = routeOperations.find((item) => item.id === dto.operationId);
        if (!operation) throw new NotFoundException("İş emri operasyonu bulunamadı");
        if (operation.status !== "PENDING" && operation.status !== "IN_PROGRESS") {
          throw new ConflictException("Bu operasyon başlatılamaz; tamamlanmış veya engellenmiş durumda");
        }
        if (routeOperations.filter((item) => item.seq < operation.seq).some((item) => item.status !== "COMPLETED" && item.status !== "SKIPPED")) {
          throw new ConflictException("Önceki rota operasyonları tamamlanmadan bu operasyon başlatılamaz");
        }
        if (operation.machineId && dto.machineId && operation.machineId !== dto.machineId) {
          throw new ConflictException("Operasyon için atanan tezgah dışında koşu başlatılamaz");
        }
        operationId = operation.id;
        assignedMachineId = operation.machineId ?? dto.machineId ?? wo.machineId ?? undefined;
        if (operation.ncProgramId) {
          if (!this.parts) throw new ConflictException("NC program policy service is unavailable");
          await this.parts.assertNcProgramUsable(tenantId, operation.ncProgramId, wo.partId, assignedMachineId, operation.ncProgramChecksum, tx);
        }
        if (this.tooling) {
          await this.tooling.assertStartReady(tx, tenantId, operation.id, wo.partId, assignedMachineId);
          await this.tooling.markStarted(tx, tenantId, operation.id);
        }
        if (operation.status === "PENDING") {
          await tx.workOrderOperation.update({
            where: { id: operation.id },
            data: { status: "IN_PROGRESS", startedAt: new Date() },
          });
        }
      } else if (dto.operationId) {
        throw new ConflictException("Bu iş emrinde rota operasyonu bulunmuyor");
      }
      if (assignedMachineId) {
        const machine = await tx.machine.findFirst({
          where: { id: assignedMachineId, tenantId, isActive: true },
        });
        if (!machine) throw new NotFoundException("Tezgah bulunamadı veya pasif");
      }

      const run = await tx.productionRun.create({
        data: {
          tenantId,
          workOrderId,
          machineId: assignedMachineId,
          operationId,
          operatorId,
          notes: dto.notes,
          source: "MANUAL", // Faz 0: her zaman manuel giriş
        },
        include: RUN_INCLUDE,
      });
      if (wo.status !== "IN_PRODUCTION") {
        await tx.workOrder.update({ where: { id: workOrderId }, data: { status: "IN_PRODUCTION" } });
      }
      await this.outbox.record(tx, tenantId, "productionrun", run.id, "productionrun.updated", { id: run.id });
      await this.outbox.record(tx, tenantId, "workorder", workOrderId, "workorder.updated", { id: workOrderId });
      return run;
    });

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
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.productionRun.update({
        where: { id },
        data: dto,
        include: RUN_INCLUDE,
      });
      if (result.operationId) await this.refreshOperationWip(tx, result.operationId);
      await this.outbox.record(tx, tenantId, "productionrun", id, "productionrun.updated", { id });
      return result;
    });
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
      const endedAt = new Date();
      const result = await tx.productionRun.update({
        where: { id },
        data: { ...runData, endedAt },
        include: RUN_INCLUDE,
      });
      if (result.operationId) await this.refreshOperationWip(tx, result.operationId);
      if (completeWorkOrder) {
        const routeOperationCount = await tx.workOrderOperation.count({ where: { tenantId, workOrderId: run.workOrderId } });
        if (routeOperationCount > 0) {
          throw new ConflictException("Rotalı iş emri doğrudan koşudan tamamlanamaz; operasyonları sırayla kapatın");
        }
        await tx.workOrder.update({ where: { id: run.workOrderId }, data: { status: "COMPLETED" } });
        await tx.machine.updateMany({
          where: { tenantId, activeWorkOrderId: run.workOrderId },
          data: { activeWorkOrderId: null },
        });
      }
      // Faz I Predictive Maintenance: kümülatif çalışma saati sayacı — koşu bir
      // makineye bağlıysa süresi kadar artırılır (geriye alınmaz/sıfırlanmaz).
      if (run.machineId) {
        const hours = Math.max(0, (endedAt.getTime() - run.startedAt.getTime()) / 1000 / 3600);
        await tx.machine.update({
          where: { id: run.machineId },
          data: { runtimeHours: { increment: hours } },
        });
      }
      await this.outbox.record(tx, tenantId, "productionrun", id, "productionrun.updated", { id });
      if (completeWorkOrder) {
        await this.outbox.record(tx, tenantId, "workorder", run.workOrderId, "workorder.updated", { id: run.workOrderId, status: "COMPLETED" });
      }
      return result;
    });

    return updated;
  }

  private async findOne(tenantId: string, id: string) {
    const run = await this.prisma.productionRun.findFirst({ where: { id, tenantId } });
    if (!run) throw new NotFoundException("Üretim koşusu bulunamadı");
    return run;
  }

  private async refreshOperationWip(tx: Prisma.TransactionClient, operationId: string) {
    const totals = await tx.productionRun.aggregate({
      where: { operationId },
      _sum: { goodCount: true, scrapCount: true },
    });
    await tx.workOrderOperation.update({
      where: { id: operationId },
      data: {
        completedQty: totals._sum.goodCount ?? 0,
        scrapQty: totals._sum.scrapCount ?? 0,
      },
    });
  }
}
