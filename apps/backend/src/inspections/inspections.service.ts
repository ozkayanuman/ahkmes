import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateInspectionDto } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { NonConformanceService } from "../non-conformance/non-conformance.service";
import { nextDocNo } from "../common/numbering";
import { writeTransactionalAudit } from "../common/transactional-audit";

const INSPECTION_INCLUDE = {
  workOrder: { select: { id: true, woNo: true } },
  inspectedBy: { select: { id: true, name: true } },
  nonConformance: { select: { id: true, failureType: true, status: true } },
} as const;

/** Kalite kontrol noktası (checkpoint) kaydı — NonConformance'ın (bir bulgu
 * kaydı) aksine burası bir muayene olayıdır. FAIL sonucunda otomatik olarak
 * NonConformance üretilir (ProductionService'in NonConformanceService'i
 * çapraz-modül çağırdığı mevcut desenle tutarlı). */
@Injectable()
export class InspectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly nonConformance: NonConformanceService,
  ) {}

  findAll(tenantId: string, workOrderId?: string) {
    return this.prisma.inspection.findMany({
      where: { tenantId, ...(workOrderId ? { workOrderId } : {}) },
      include: INSPECTION_INCLUDE,
      orderBy: { inspectedAt: "desc" },
    });
  }

  async findOne(tenantId: string, id: string) {
    const ins = await this.prisma.inspection.findFirst({ where: { id, tenantId }, include: INSPECTION_INCLUDE });
    if (!ins) throw new NotFoundException("Muayene kaydı bulunamadı");
    return ins;
  }

  async create(tenantId: string, userId: string, dto: CreateInspectionDto) {
    const wo = await this.prisma.workOrder.findFirst({ where: { id: dto.workOrderId, tenantId } });
    if (!wo) throw new NotFoundException("İş emri bulunamadı");

    let qualityPlanCheck: { checkpointName: string; unit: string | null; lowerLimit: unknown; upperLimit: unknown; requiresMeasurement: boolean } | null = null;
    if (dto.qualityPlanCheckId) {
      qualityPlanCheck = await this.prisma.qualityPlanCheck.findFirst({
        where: { id: dto.qualityPlanCheckId, tenantId, qualityPlan: { isActive: true } },
        select: { checkpointName: true, unit: true, lowerLimit: true, upperLimit: true, requiresMeasurement: true },
      });
      if (!qualityPlanCheck) throw new NotFoundException("Aktif kalite planı kontrol satırı bulunamadı");
      if (qualityPlanCheck.requiresMeasurement && dto.measurementValue === undefined) throw new BadRequestException("Bu kontrol noktası için ölçüm zorunlu");
    }

    const measured = dto.measurementValue === undefined ? null : Number(dto.measurementValue);
    const outOfTolerance = qualityPlanCheck && measured !== null &&
      ((qualityPlanCheck.lowerLimit !== null && measured < Number(qualityPlanCheck.lowerLimit)) ||
       (qualityPlanCheck.upperLimit !== null && measured > Number(qualityPlanCheck.upperLimit)));
    const result = outOfTolerance ? "FAIL" : dto.result;
    const checkpointName = qualityPlanCheck?.checkpointName ?? dto.checkpointName;
    // A plan-controlled inspection must retain the plan's immutable checkpoint name
    // in its linked non-conformance as well as in the inspection record.
    dto.checkpointName = checkpointName;
    let nonConformanceId: string | undefined;
    if (result === "FAIL") {
      const nc = await this.nonConformance.create(tenantId, userId, {
        workOrderId: dto.workOrderId,
        productionRunId: dto.productionRunId,
        failureType: `Muayene hatası: ${dto.checkpointName}`,
        description: dto.notes,
        actionType: "GENERIC",
      });
      nonConformanceId = nc.id;
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const insNo = await nextDocNo(tx, "inspection", "insNo", "MUA");
      const inspection = await tx.inspection.create({
        data: {
          tenantId,
          insNo,
          workOrderId: dto.workOrderId,
          productionRunId: dto.productionRunId,
          checkpointName,
          qualityPlanCheckId: dto.qualityPlanCheckId,
          measurementValue: dto.measurementValue,
          measurementUnit: dto.measurementUnit ?? qualityPlanCheck?.unit ?? undefined,
          result,
          notes: dto.notes,
          nonConformanceId,
          inspectedById: userId,
        },
        include: INSPECTION_INCLUDE,
      });
      await writeTransactionalAudit(tx, {
        tenantId,
        userId,
        entity: "inspections",
        entityId: inspection.id,
        action: "CREATE",
        after: inspection,
      });
      return inspection;
    });

    this.realtime.emitToTenant(tenantId, "inspection.created", {
      id: created.id,
      workOrderId: dto.workOrderId,
      result,
    });
    return created;
  }
}
