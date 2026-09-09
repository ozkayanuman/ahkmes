import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InspectionResult, InventoryMovementType, Prisma, QualityDispositionType } from "@prisma/client";
import type { CreateInspectionLotDto, CreateQualityDispositionDto, QualityReleaseDto, SubmitInspectionMeasurementDto } from "@ahkmes/shared-types";
import { InventoryService } from "../inventory/inventory.service";
import { OutboxService } from "../outbox/outbox.service";
import { PrismaService } from "../prisma/prisma.service";
import { writeTransactionalAudit } from "../common/transactional-audit";

type SnapshotCheck = { seq: number; checkpointName: string; unit?: string; lowerLimit?: string; upperLimit?: string; characteristicType: "NUMERIC" | "BOOLEAN" | "QUALITATIVE"; qualitativeExpected?: string; isRequired: boolean };
type RequirementSnapshot = { checks: SnapshotCheck[]; samplingMethod: "HUNDRED_PERCENT" | "FIXED_COUNT"; sampleCount?: number };

@Injectable()
export class QualityExecutionService {
  constructor(private readonly prisma: PrismaService, private readonly inventory: InventoryService, private readonly outbox: OutboxService) {}

  lots(tenantId: string, workOrderId?: string) { return this.prisma.inspectionLot.findMany({ where: { tenantId, ...(workOrderId ? { workOrderId } : {}) }, include: { requirement: true, measurements: true, nonConformance: true, holds: true }, orderBy: { createdAt: "desc" } }); }
  requirements(tenantId: string) { return this.prisma.productionQualityRequirement.findMany({ where: { tenantId }, include: { workOrder: { select: { woNo: true, part: { select: { partNo: true, name: true } } } }, operation: { select: { seq: true, name: true } } }, orderBy: { createdAt: "desc" } }); }

  async createLot(tenantId: string, userId: string, dto: CreateInspectionLotDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.inspectionLot.findFirst({ where: { tenantId, idempotencyKey: dto.idempotencyKey } }); if (existing) return existing;
      const req = await tx.productionQualityRequirement.findFirst({ where: { id: dto.requirementId, tenantId } });
      if (!req || (dto.operationId && req.operationId !== dto.operationId)) throw new NotFoundException("Released quality requirement was not found");
      if (dto.lotId && !await tx.lot.findFirst({ where: { id: dto.lotId, tenantId, itemType: "PART" } })) throw new NotFoundException("Output lot was not found");
      const sample = req.samplingMethod === "FIXED_COUNT" ? req.sampleCount! : 1;
      const created = await tx.inspectionLot.create({ data: { tenantId, requirementId: req.id, workOrderId: req.workOrderId, operationId: req.operationId, productionRunId: dto.productionRunId, lotId: dto.lotId, inspectionPoint: req.inspectionPoint, requiredSamples: sample, idempotencyKey: dto.idempotencyKey, inspectorId: userId } });
      await writeTransactionalAudit(tx, { tenantId, userId, entity: "inspection-lot", entityId: created.id, action: "CREATE", after: created });
      return created;
    });
  }

  async submitMeasurement(tenantId: string, userId: string, inspectionLotId: string, dto: SubmitInspectionMeasurementDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.inspectionMeasurement.findFirst({ where: { tenantId, idempotencyKey: dto.idempotencyKey } }); if (existing) return existing;
      await tx.$queryRaw`SELECT "id" FROM "InspectionLot" WHERE "id" = ${inspectionLotId} AND "tenantId" = ${tenantId} FOR UPDATE`;
      const lot = await tx.inspectionLot.findFirst({ where: { id: inspectionLotId, tenantId }, include: { requirement: true } });
      if (!lot || ["PASSED", "FAILED", "CANCELLED"].includes(lot.status)) throw new ConflictException("Inspection lot is not open for measurement");
      if (dto.sampleNo > lot.requiredSamples) throw new ConflictException("Sample number exceeds the released sampling requirement");
      const snapshot = lot.requirement.snapshot as unknown as RequirementSnapshot;
      const check = snapshot.checks.find((item) => item.seq === dto.checkSeq); if (!check) throw new NotFoundException("Released inspection characteristic was not found");
      let result: InspectionResult;
      if (check.characteristicType === "NUMERIC") {
        if (dto.numericValue === undefined) throw new ConflictException("Numeric characteristic requires a measurement");
        if (dto.unit && check.unit && dto.unit.toUpperCase() !== check.unit.toUpperCase()) throw new ConflictException("Measurement UOM must match the released characteristic UOM");
        const value = new Prisma.Decimal(dto.numericValue); const low = check.lowerLimit === undefined ? undefined : new Prisma.Decimal(check.lowerLimit); const high = check.upperLimit === undefined ? undefined : new Prisma.Decimal(check.upperLimit);
        result = (!low || value.gte(low)) && (!high || value.lte(high)) ? "PASS" : "FAIL";
      } else {
        if (!dto.resultValue) throw new ConflictException("Qualitative characteristic requires a result");
        result = dto.resultValue.trim().toUpperCase() === (check.qualitativeExpected ?? "PASS").trim().toUpperCase() ? "PASS" : "FAIL";
      }
      const measurement = await tx.inspectionMeasurement.create({ data: { tenantId, inspectionLotId, checkSeq: check.seq, sampleNo: dto.sampleNo, characteristicType: check.characteristicType, numericValue: dto.numericValue, resultValue: dto.resultValue, unit: dto.unit ?? check.unit, result, notes: dto.notes, inspectedById: userId, idempotencyKey: dto.idempotencyKey } });
      const measurements = await tx.inspectionMeasurement.findMany({ where: { inspectionLotId } });
      const requiredChecks = snapshot.checks.filter((item) => item.isRequired); const expected = lot.requiredSamples * requiredChecks.length;
      const failed = measurements.some((item) => item.result === "FAIL");
      if (failed) {
        const nc = await tx.nonConformance.create({ data: { tenantId, workOrderId: lot.workOrderId, productionRunId: lot.productionRunId, reportedById: userId, failureType: "Failed released inspection", description: `Inspection lot ${lot.id} failed`, actionType: "BLOCKING", status: "OPEN" } });
        await tx.inspectionLot.update({ where: { id: lot.id }, data: { status: "FAILED", completedAt: new Date(), nonConformanceId: nc.id } });
        const heldBalance = lot.lotId ? await tx.stockBalance.aggregate({ where: { tenantId, lotId: lot.lotId }, _sum: { qty: true } }) : null;
        const hold = await tx.qualityHold.create({ data: { tenantId, target: lot.lotId ? "OUTPUT_LOT" : lot.operationId ? "OPERATION" : "WORK_ORDER", workOrderId: lot.workOrderId, operationId: lot.operationId, lotId: lot.lotId, inspectionLotId: lot.id, quantity: heldBalance?._sum.qty ?? undefined, reason: "Required inspection failed", source: "INSPECTION_LOT", idempotencyKey: `inspection-fail:${lot.id}`, createdById: userId } });
        await writeTransactionalAudit(tx, { tenantId, userId, entity: "quality-hold", entityId: hold.id, action: "CREATE", after: hold });
      } else if (measurements.length >= expected) {
        await tx.inspectionLot.update({ where: { id: lot.id }, data: { status: "PASSED", completedAt: new Date() } });
        // A reinspection is new evidence, never a mutation of the failed lot.
        // It resolves rework only after the authorized quantity was actually
        // processed by the CNC-V1-04 execution path.
        if (lot.productionRunId) {
          const rework = await tx.reworkRequirement.findFirst({ where: { tenantId, reworkRunId: lot.productionRunId, status: "OPEN" } });
          if (rework && new Prisma.Decimal(rework.processedQty).gte(rework.quantity)) {
            await tx.reworkRequirement.update({ where: { id: rework.id }, data: { status: "RESOLVED" } });
          }
        }
      } else await tx.inspectionLot.update({ where: { id: lot.id }, data: { status: "IN_PROGRESS" } });
      await writeTransactionalAudit(tx, { tenantId, userId, entity: "inspection-measurement", entityId: measurement.id, action: "CREATE", after: measurement });
      await this.outbox.record(tx, tenantId, "inspection-lot", lot.id, "inspection.updated", { id: lot.id, result });
      return measurement;
    });
  }

  async assertOperationClear(tenantId: string, workOrderId: string, operationId: string) {
    const reqs = await this.prisma.productionQualityRequirement.findMany({ where: { tenantId, workOrderId, operationId, inspectionPoint: "IN_PROCESS" } });
    for (const req of reqs) { const passed = await this.prisma.inspectionLot.findFirst({ where: { tenantId, requirementId: req.id, status: "PASSED" } }); if (!passed) throw new ConflictException("QUALITY_INSPECTION_REQUIRED"); }
    await this.assertNoActiveHold(tenantId, workOrderId, operationId);
  }

  /** Start/resume can block on a real hold without incorrectly requiring an
   * in-process inspection that is intentionally scheduled for completion. */
  async assertNoActiveHold(tenantId: string, workOrderId: string, operationId: string) {
    const hold = await this.prisma.qualityHold.findFirst({ where: { tenantId, status: "ACTIVE", OR: [{ workOrderId }, { operationId }] } });
    if (hold) throw new ConflictException("QUALITY_HOLD_ACTIVE");
  }

  async operationStatus(tenantId: string, workOrderId: string, operationId: string) {
    const requirements = await this.prisma.productionQualityRequirement.findMany({
      where: { tenantId, workOrderId, operationId, inspectionPoint: "IN_PROCESS" },
      include: { inspectionLots: { include: { holds: { where: { status: "ACTIVE" } }, nonConformance: { include: { reworkRequirements: { where: { status: "OPEN" } } } } } } },
    });
    const lots = requirements.flatMap((requirement) => requirement.inspectionLots);
    const holdCount = lots.reduce((total, lot) => total + lot.holds.length, 0);
    const reworkCount = lots.reduce((total, lot) => total + (lot.nonConformance?.reworkRequirements.length ?? 0), 0);
    const required = requirements.length > 0;
    const passed = !required || requirements.every((requirement) => requirement.inspectionLots.some((lot) => lot.status === "PASSED"));
    return { required, passed, pending: required && !passed, failed: lots.some((lot) => lot.status === "FAILED"), activeHoldCount: holdCount, pendingReworkCount: reworkCount };
  }

  async disposition(tenantId: string, userId: string, ncId: string, dto: CreateQualityDispositionDto, isUseAsIsApprover: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.qualityDisposition.findFirst({ where: { tenantId, idempotencyKey: dto.idempotencyKey } }); if (existing) return existing;
      await tx.$queryRaw`SELECT "id" FROM "NonConformance" WHERE "id" = ${ncId} AND "tenantId" = ${tenantId} FOR UPDATE`;
      const nc = await tx.nonConformance.findFirst({ where: { id: ncId, tenantId }, include: { inspectionLot: true } }); if (!nc || nc.status === "RESOLVED") throw new ConflictException("NCR is not open for disposition");
      if (nc.status === "DISPOSITIONED") throw new ConflictException("NCR already has a terminal disposition");
      if (dto.type === "USE_AS_IS" && !isUseAsIsApprover) throw new ConflictException("NCR_USE_AS_IS_APPROVE permission is required");
      const disposition = await tx.qualityDisposition.create({ data: { tenantId, nonConformanceId: nc.id, type: dto.type as QualityDispositionType, quantity: dto.quantity, reason: dto.reason, idempotencyKey: dto.idempotencyKey, decidedById: userId } });
      if (dto.type === "REWORK") await tx.reworkRequirement.create({ data: { tenantId, nonConformanceId: nc.id, workOrderId: nc.workOrderId, operationId: nc.inspectionLot?.operationId, quantity: dto.quantity ?? 1 } });
      if (dto.type === "SCRAP") {
        const lotId = nc.inspectionLot?.lotId; if (!lotId || !dto.quantity) throw new ConflictException("SCRAP disposition requires an affected output lot and quantity");
        const lot = await tx.lot.findFirst({ where: { id: lotId, tenantId } }); if (!lot) throw new NotFoundException("Affected output lot was not found");
        const balance = await tx.stockBalance.findFirst({ where: { tenantId, itemType: lot.itemType, itemId: lot.itemId, lotId } }); if (!balance) throw new ConflictException("Affected output lot has no physical balance");
        await this.inventory.record(tx, { tenantId, itemType: lot.itemType, itemId: lot.itemId, lotId, binId: balance.binId, quantityDelta: -Number(dto.quantity), movementType: InventoryMovementType.QUALITY_SCRAP, sourceType: "QUALITY_NCR", sourceId: nc.id, sourceLineId: disposition.id, createdById: userId, note: dto.reason });
      }
      await tx.nonConformance.update({ where: { id: nc.id }, data: { status: "DISPOSITIONED", resolutionNote: dto.reason } });
      await writeTransactionalAudit(tx, { tenantId, userId, entity: "quality-disposition", entityId: disposition.id, action: "CREATE", after: disposition });
      return disposition;
    });
  }

  async release(tenantId: string, userId: string, holdId: string, dto: QualityReleaseDto) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "QualityHold" WHERE "id" = ${holdId} AND "tenantId" = ${tenantId} FOR UPDATE`;
      const hold = await tx.qualityHold.findFirst({ where: { id: holdId, tenantId } }); if (!hold) throw new NotFoundException("Quality hold was not found"); if (hold.status === "RELEASED") return hold;
      const failedLot = hold.inspectionLotId ? await tx.inspectionLot.findFirst({ where: { id: hold.inspectionLotId }, include: { nonConformance: { include: { dispositions: true, reworkRequirements: true } } } }) : null;
      const disposition = failedLot?.nonConformance?.dispositions[0];
      const reworkResolved = disposition?.type === "REWORK" && failedLot?.nonConformance?.reworkRequirements.some((item) => item.status === "RESOLVED");
      if (failedLot?.status === "FAILED" && !reworkResolved && !failedLot.nonConformance?.dispositions.some((item) => item.type === "ACCEPT" || item.type === "USE_AS_IS")) throw new ConflictException("QUALITY_DISPOSITION_REQUIRED");
      const released = await tx.qualityHold.update({ where: { id: hold.id }, data: { status: "RELEASED", releasedById: userId, releasedAt: new Date(), releaseReason: dto.reason } });
      await writeTransactionalAudit(tx, { tenantId, userId, entity: "quality-hold", entityId: hold.id, action: "STATUS_CHANGE", before: { status: "ACTIVE" }, after: { status: "RELEASED", reason: dto.reason } }); return released;
    });
  }
}
