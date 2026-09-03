import { ConflictException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, ProductionExecutionEventType } from "@prisma/client";
import type { HmiLifecycleCommandDto, HmiProductionReportDto, StartProductionRunDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { OutboxService } from "../outbox/outbox.service";
import { NonConformanceService } from "../non-conformance/non-conformance.service";
import { AppException } from "../common/app-exception";
import { PartsService } from "../parts/parts.service";
import { ToolingService } from "../tooling/tooling.service";
import { ProductionMaterialService } from "../production-material/production-material.service";
import { QualityExecutionService } from "../quality-execution/quality-execution.service";
import { ProductionCalendarService } from "../production-calendar/production-calendar.service";
import { writeTransactionalAudit } from "../common/transactional-audit";
import { ControllerVerificationService } from "../controller-verification/controller-verification.service";
import { MachineMaintenanceAvailabilityService } from "../machines/machine-maintenance-availability.service";

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
    private readonly materials?: ProductionMaterialService,
    private readonly quality?: QualityExecutionService,
    private readonly calendar?: ProductionCalendarService,
    private readonly controllerVerification?: ControllerVerificationService,
    private readonly maintenanceAvailability?: MachineMaintenanceAvailabilityService,
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
      // A released order transitions to IN_PRODUCTION after its first run;
      // subsequent partial runs must retain the same immutable release rather
      // than becoming impossible to start.
      if (wo.engineeringReleaseRequired && wo.status !== "RELEASED" && wo.status !== "IN_PRODUCTION") throw new ConflictException("Work order must be engineering-released before production starts");
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
        if (this.controllerVerification) await this.controllerVerification.assertOperationReady(tenantId, { machineId: operation.machineId, workOrder: { machineId: wo.machineId }, ncProgramFileName: operation.ncProgramFileName }, tx);
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
        await this.maintenanceAvailability?.assertProductionAvailable(tenantId, assignedMachineId, new Date(), tx);
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
      if (operationId) await this.event(tx, tenantId, operatorId, workOrderId, operationId, run.id, "START", `start:${run.id}`);
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
      if (result.operationId && this.materials && dto.goodCount !== undefined) {
        await this.materials.backflush(tenantId, run.operatorId, result.workOrderId, result.operationId, dto.goodCount ?? 0, dto.scrapCount ?? 0, `production-run:${result.id}`, tx);
      }
      if (result.operationId) await this.refreshOperationWip(tx, result.operationId);
      await this.outbox.record(tx, tenantId, "productionrun", id, "productionrun.updated", { id });
      return result;
    });
    return updated;
  }

  async setupStart(tenantId: string, userId: string, operationId: string, dto: HmiLifecycleCommandDto) {
    return this.transition(tenantId, userId, operationId, dto, ["PENDING"], "SETUP", "SETUP_START");
  }

  async setupComplete(tenantId: string, userId: string, operationId: string, dto: HmiLifecycleCommandDto) {
    return this.transition(tenantId, userId, operationId, dto, ["SETUP"], "PENDING", "SETUP_COMPLETE", async (tx, operation) => {
      if (this.tooling) await this.tooling.assertStartReady(tx, tenantId, operation.id, operation.workOrder.partId, operation.machineId ?? operation.workOrder.machineId ?? undefined);
    });
  }

  async pause(tenantId: string, userId: string, operationId: string, dto: HmiLifecycleCommandDto) {
    if (!dto.reasonCode) throw new ConflictException("PAUSE_REASON_REQUIRED");
    return this.transition(tenantId, userId, operationId, dto, ["IN_PROGRESS", "REWORK"], "PAUSED", "PAUSE", undefined, true);
  }

  async resume(tenantId: string, userId: string, operationId: string, dto: HmiLifecycleCommandDto) {
    return this.transition(tenantId, userId, operationId, dto, ["PAUSED"], "IN_PROGRESS", "RESUME", async (_tx, operation) => {
      if (this.quality) await this.quality.assertNoActiveHold(tenantId, operation.workOrderId, operation.id);
      await this.assertMaterialReady(tenantId, operation.workOrderId);
      const machineId = operation.machineId ?? operation.workOrder.machineId;
      if (machineId) await this.maintenanceAvailability?.assertProductionAvailable(tenantId, machineId, new Date(), _tx);
      if (this.controllerVerification) await this.controllerVerification.assertOperationReady(tenantId, operation, _tx);
    }, true);
  }

  async hold(tenantId: string, userId: string, operationId: string, dto: HmiLifecycleCommandDto) {
    if (!dto.reasonCode) throw new ConflictException("HOLD_REASON_REQUIRED");
    return this.transition(tenantId, userId, operationId, dto, ["IN_PROGRESS", "PAUSED", "REWORK"], "HELD", "HOLD", undefined, true);
  }

  async releaseHold(tenantId: string, userId: string, operationId: string, dto: HmiLifecycleCommandDto) {
    return this.transition(tenantId, userId, operationId, dto, ["HELD"], "PAUSED", "HOLD_RELEASE", async (_tx, operation) => {
      if (this.quality) await this.quality.assertNoActiveHold(tenantId, operation.workOrderId, operation.id);
    }, true);
  }

  async report(tenantId: string, userId: string, operationId: string, dto: HmiProductionReportDto) {
    if (!Number.isInteger(dto.goodQty) || !Number.isInteger(dto.scrapQty)) throw new ConflictException("Production report quantities must be whole units in V1");
    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.productionReport.findFirst({ where: { tenantId, idempotencyKey: dto.idempotencyKey } }); if (previous) return previous;
      await tx.$queryRaw`SELECT "id" FROM "WorkOrderOperation" WHERE "id" = ${operationId} AND "tenantId" = ${tenantId} FOR UPDATE`;
      const operation = await tx.workOrderOperation.findFirst({ where: { id: operationId, tenantId }, include: { workOrder: true } });
      if (!operation || operation.status !== "IN_PROGRESS") throw new ConflictException("OPERATION_NOT_RUNNING");
      const run = await tx.productionRun.findFirst({ where: { tenantId, operationId, endedAt: null } }); if (!run) throw new ConflictException("ACTIVE_RUN_REQUIRED");
      const processed = new Prisma.Decimal(operation.completedQty).plus(operation.scrapQty).plus(dto.goodQty).plus(dto.scrapQty);
      if (processed.gt(operation.workOrder.quantity)) throw new ConflictException("OVERPRODUCTION_NOT_AUTHORIZED");
      const report = await tx.productionReport.create({ data: { tenantId, workOrderId: operation.workOrderId, operationId, productionRunId: run.id, goodQty: dto.goodQty, scrapQty: dto.scrapQty, reasonCode: dto.reasonCode, note: dto.note, idempotencyKey: dto.idempotencyKey, reportedById: userId } });
      await tx.productionRun.update({ where: { id: run.id }, data: { goodCount: { increment: dto.goodQty }, scrapCount: { increment: dto.scrapQty } } });
      if (this.materials) await this.materials.backflush(tenantId, userId, operation.workOrderId, operationId, dto.goodQty, dto.scrapQty, `report:${report.id}`, tx);
      await this.refreshOperationWip(tx, operationId);
      await this.event(tx, tenantId, userId, operation.workOrderId, operationId, run.id, "REPORT", `event:${dto.idempotencyKey}`, dto.reasonCode, dto.note);
      await writeTransactionalAudit(tx, { tenantId, userId, entity: "production-report", entityId: report.id, action: "CREATE", after: report });
      return report;
    });
  }

  async startRework(tenantId: string, userId: string, operationId: string, reworkRequirementId: string, dto: HmiLifecycleCommandDto) {
    const started = await this.prisma.$transaction(async (tx) => {
      const previous = await tx.productionExecutionEvent.findFirst({ where: { tenantId, idempotencyKey: dto.idempotencyKey } }); if (previous) return previous;
      await tx.$queryRaw`SELECT "id" FROM "WorkOrderOperation" WHERE "id" = ${operationId} AND "tenantId" = ${tenantId} FOR UPDATE`;
      const requirement = await tx.reworkRequirement.findFirst({ where: { id: reworkRequirementId, tenantId, status: "OPEN", operationId }, include: { workOrder: true, nonConformance: { include: { inspectionLot: true } } } });
      if (!requirement) throw new ConflictException("REWORK_REQUIREMENT_NOT_EXECUTABLE");
      const operation = await tx.workOrderOperation.findFirst({ where: { id: operationId, tenantId, workOrderId: requirement.workOrderId } });
      if (!operation || operation.status === "HELD") throw new ConflictException("REWORK_OPERATION_NOT_AVAILABLE");
      // A failed inspection may be recorded while its source run is still open,
      // or after the original operation completed.  Preserve that run as
      // immutable history and begin a separate rework run; never rewrite it.
      const active = await tx.productionRun.findFirst({ where: { tenantId, operationId, endedAt: null } });
      if (active) await tx.productionRun.update({ where: { id: active.id }, data: { endedAt: new Date() } });
      const run = await tx.productionRun.create({ data: { tenantId, workOrderId: requirement.workOrderId, operationId, machineId: operation.machineId ?? requirement.workOrder.machineId, operatorId: userId, notes: dto.note } });
      await tx.workOrderOperation.update({ where: { id: operationId }, data: { status: "REWORK" } });
      await tx.reworkRequirement.update({ where: { id: requirement.id }, data: { reworkOperationId: operationId, reworkRunId: run.id } });
      await this.event(tx, tenantId, userId, requirement.workOrderId, operationId, run.id, "REWORK_START", dto.idempotencyKey, dto.reasonCode, dto.note);
      return { run, requirementId: requirement.id, sourceLotId: requirement.nonConformance.inspectionLot?.lotId, sourceRequirementId: requirement.nonConformance.inspectionLot?.requirementId };
    });
    // An idempotent retry that found the existing lifecycle event returns that
    // event and has already created its lot on the original request.
    if (!("run" in started)) return started;
    if (!this.quality || !started.sourceRequirementId) throw new ConflictException("REINSPECTION_REQUIREMENT_NOT_AVAILABLE");
    const reinspectionLot = await this.quality.createLot(tenantId, userId, {
      requirementId: started.sourceRequirementId,
      operationId,
      productionRunId: started.run.id,
      ...(started.sourceLotId ? { lotId: started.sourceLotId } : {}),
      idempotencyKey: `reinspection:${dto.idempotencyKey}`,
    });
    return { ...started.run, reinspectionLotId: reinspectionLot.id };
  }

  async reportRework(tenantId: string, userId: string, operationId: string, quantity: number, dto: HmiLifecycleCommandDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.productionExecutionEvent.findFirst({ where: { tenantId, idempotencyKey: dto.idempotencyKey } }); if (existing) return existing;
      await tx.$queryRaw`SELECT "id" FROM "WorkOrderOperation" WHERE "id" = ${operationId} AND "tenantId" = ${tenantId} FOR UPDATE`;
      const requirement = await tx.reworkRequirement.findFirst({ where: { tenantId, reworkOperationId: operationId, status: "OPEN" } });
      if (!requirement) throw new ConflictException("REWORK_REQUIREMENT_NOT_ACTIVE");
      const total = new Prisma.Decimal(requirement.processedQty).plus(quantity); if (total.gt(requirement.quantity)) throw new ConflictException("REWORK_QUANTITY_EXCEEDS_AFFECTED_QUANTITY");
      // Quantity completion is intentionally not the same as quality release.
      // The requirement stays OPEN until a new reinspection passes.
      await tx.reworkRequirement.update({ where: { id: requirement.id }, data: { processedQty: total } });
      return this.event(tx, tenantId, userId, requirement.workOrderId, operationId, requirement.reworkRunId ?? undefined, total.eq(requirement.quantity) ? "REWORK_COMPLETE" : "REPORT", dto.idempotencyKey, dto.reasonCode, dto.note);
    });
  }

  /** Canonical HMI terminal operation command.  It locks the operation before
   * ending its run, so PAUSE/COMPLETE races cannot leave a paused operation
   * with an ended run.  Incremental reports already own quantities; this path
   * never overwrites them. */
  async completeOperation(tenantId: string, userId: string, operationId: string, dto: { notes?: string; idempotencyKey: string }) {
    if (this.quality) {
      const operation = await this.prisma.workOrderOperation.findFirst({ where: { id: operationId, tenantId } });
      if (!operation) throw new NotFoundException("Work order operation was not found");
      await this.quality.assertOperationClear(tenantId, operation.workOrderId, operationId);
    }
    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.productionExecutionEvent.findFirst({ where: { tenantId, idempotencyKey: dto.idempotencyKey } });
      if (previous) return previous;
      await tx.$queryRaw`SELECT "id" FROM "WorkOrderOperation" WHERE "id" = ${operationId} AND "tenantId" = ${tenantId} FOR UPDATE`;
      const operation = await tx.workOrderOperation.findFirst({ where: { id: operationId, tenantId }, include: { workOrder: true } });
      if (!operation || operation.status !== "IN_PROGRESS") throw new ConflictException("INVALID_EXECUTION_TRANSITION");
      const processed = new Prisma.Decimal(operation.completedQty).plus(operation.scrapQty);
      if (!processed.eq(operation.workOrder.quantity)) throw new ConflictException("QUANTITY_ACCOUNTING_INCOMPLETE");
      const run = await tx.productionRun.findFirst({ where: { tenantId, operationId, endedAt: null } });
      if (!run) throw new ConflictException("ACTIVE_RUN_REQUIRED");
      const endedAt = new Date();
      await tx.productionRun.update({ where: { id: run.id }, data: { endedAt, ...(dto.notes !== undefined ? { notes: dto.notes } : {}) } });
      await tx.workOrderOperation.update({ where: { id: operationId }, data: { status: "COMPLETED", completedAt: endedAt, ...(dto.notes !== undefined ? { notes: dto.notes } : {}) } });
      if (this.tooling) await this.tooling.completeOperation(tx, tenantId, userId, operationId);
      const event = await this.event(tx, tenantId, userId, operation.workOrderId, operationId, run.id, "COMPLETE", dto.idempotencyKey, undefined, dto.notes);
      await writeTransactionalAudit(tx, { tenantId, userId, entity: "production-execution", entityId: event.id, action: "STATUS_CHANGE", before: { status: "IN_PROGRESS" }, after: { status: "COMPLETED", processed: processed.toString() } });
      await this.outbox.record(tx, tenantId, "productionrun", run.id, "productionrun.updated", { id: run.id });
      await this.outbox.record(tx, tenantId, "workorder", operation.workOrderId, "workorder.updated", { id: operation.workOrderId });
      return event;
    });
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
      // HMI completes a run through this path (rather than update).  Keep the
      // same cumulative, idempotent BACKFLUSH contract in both paths.
      if (result.operationId && this.materials && (dto.goodCount !== undefined || dto.scrapCount !== undefined)) {
        await this.materials.backflush(
          tenantId,
          run.operatorId,
          result.workOrderId,
          result.operationId,
          dto.goodCount ?? 0,
          dto.scrapCount ?? 0,
          `production-run:${result.id}`,
          tx,
        );
      }
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

  private async transition(
    tenantId: string, userId: string, operationId: string, dto: HmiLifecycleCommandDto,
    from: string[], to: "SETUP" | "PENDING" | "PAUSED" | "IN_PROGRESS" | "HELD",
    type: ProductionExecutionEventType, validate?: (tx: Prisma.TransactionClient, operation: any) => Promise<void>, requireRun = false,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.productionExecutionEvent.findFirst({ where: { tenantId, idempotencyKey: dto.idempotencyKey } }); if (previous) return previous;
      await tx.$queryRaw`SELECT "id" FROM "WorkOrderOperation" WHERE "id" = ${operationId} AND "tenantId" = ${tenantId} FOR UPDATE`;
      const operation = await tx.workOrderOperation.findFirst({ where: { id: operationId, tenantId }, include: { workOrder: true } });
      if (!operation || !from.includes(operation.status)) throw new ConflictException("INVALID_EXECUTION_TRANSITION");
      const run = await tx.productionRun.findFirst({ where: { tenantId, operationId, endedAt: null } });
      if (requireRun && !run) throw new ConflictException("ACTIVE_RUN_REQUIRED");
      if (validate) await validate(tx, operation);
      await tx.workOrderOperation.update({ where: { id: operationId }, data: { status: to } });
      const event = await this.event(tx, tenantId, userId, operation.workOrderId, operationId, run?.id, type, dto.idempotencyKey, dto.reasonCode, dto.note);
      await writeTransactionalAudit(tx, { tenantId, userId, entity: "production-execution", entityId: event.id, action: "STATUS_CHANGE", before: { status: operation.status }, after: { status: to, type, reasonCode: dto.reasonCode } });
      return event;
    });
  }

  private async event(tx: Prisma.TransactionClient, tenantId: string, actorId: string, workOrderId: string, operationId: string, productionRunId: string | undefined, type: ProductionExecutionEventType, idempotencyKey: string, reasonCode?: string, note?: string) {
    const existing = await tx.productionExecutionEvent.findFirst({ where: { tenantId, idempotencyKey } }); if (existing) return existing;
    const operation = await tx.workOrderOperation.findUniqueOrThrow({ where: { id: operationId }, select: { workOrder: { select: { plantId: true } } } });
    const attribution = operation.workOrder.plantId && this.calendar ? await this.calendar.resolve(tenantId, operation.workOrder.plantId, new Date()) : null;
    return tx.productionExecutionEvent.create({ data: { tenantId, actorId, workOrderId, operationId, productionRunId, type, reasonCode, note, idempotencyKey, shiftId: attribution?.shift?.id, productionDate: attribution?.productionDate } });
  }

  private async assertMaterialReady(tenantId: string, workOrderId: string) {
    if (!this.materials) return;
    const requirements = await this.materials.requirements(tenantId, workOrderId);
    const shortage = requirements.find((item) => item.issueMethod === "MANUAL_ISSUE" && new Prisma.Decimal(item.reservedQty).plus(item.issuedQty).lt(item.requiredQty));
    if (shortage) throw new ConflictException("MATERIAL_SHORTAGE");
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
